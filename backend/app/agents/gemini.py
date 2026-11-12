"""Gemini behind the small slice of the OpenAI Responses API that pipeline.py uses.

Only `responses.parse` (structured output) and `responses.create` (with tools and
`previous_response_id`) are implemented, returning objects with the same attributes
pipeline.py reads. That keeps both orchestration modes identical across providers.
"""
import json
import time
import uuid
from types import SimpleNamespace

import httpx

_URL = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"
_HISTORY: dict[str, tuple[dict | None, list[dict]]] = {}  # response id -> (system, contents)


class GeminiClient:
    def __init__(self, api_key: str):
        self._key = api_key
        self.responses = SimpleNamespace(parse=self._parse, create=self._create)

    # -- transport ---------------------------------------------------------
    def _post(self, model: str, body: dict) -> dict:
        # ponytail: fixed backoff for free-tier 429/503; honour retryDelay if throughput matters
        for attempt in range(6):
            try:
                r = httpx.post(_URL.format(model), json=body, headers={"x-goog-api-key": self._key}, timeout=60)
            except httpx.TimeoutException:  # occasional stalled request: retry
                if attempt < 5:
                    continue
                raise
            if r.status_code == 429 and 'PerDay' in r.text:  # daily quota: waiting minutes won't help
                raise RuntimeError(f"Gemini daily quota exhausted for {model}: {r.text[:200]}")
            if r.status_code in (429, 500, 503) and attempt < 5:
                time.sleep(min(60, 5 * 2**attempt))
                continue
            if r.is_error:
                raise RuntimeError(f"Gemini {r.status_code}: {r.text[:300]}")
            return r.json()

    # -- request building ---------------------------------------------------
    @staticmethod
    def _contents(items: list[dict], contents: list[dict], system: dict | None):
        """Append OpenAI-style input items to `contents`; returns the (maybe new) system."""
        for it in items:
            if it.get("type") == "function_call_output":
                part = {"functionResponse": {"name": it["call_id"].split(":")[0],
                                             "response": json.loads(it["output"])}}
                if contents and contents[-1]["role"] == "user" and "functionResponse" in contents[-1]["parts"][0]:
                    contents[-1]["parts"].append(part)  # parallel results share one turn
                else:
                    contents.append({"role": "user", "parts": [part]})
            elif it["role"] == "system":
                system = {"parts": [{"text": it["content"]}]}
            else:
                contents.append({"role": "model" if it["role"] == "assistant" else "user",
                                 "parts": [{"text": it["content"]}]})
        return system

    def _send(self, model, items, previous_response_id=None, tools=None, schema=None):
        system, contents = _HISTORY.get(previous_response_id, (None, []))
        contents = list(contents)
        system = self._contents(items, contents, system)
        body: dict = {"contents": contents}
        if system:
            body["systemInstruction"] = system
        if tools:
            body["tools"] = [{"functionDeclarations": [
                {"name": t["name"], "description": t["description"], "parametersJsonSchema": t["parameters"]}
                for t in tools]}]
        if schema:
            body["generationConfig"] = {"responseMimeType": "application/json", "responseJsonSchema": schema}
        data = self._post(model, body)
        cand = data["candidates"][0]
        parts = cand.get("content", {}).get("parts", [])
        rid = uuid.uuid4().hex
        # raw model parts are kept as-is: Gemini 3 needs its thought signatures echoed back
        _HISTORY[rid] = (system, contents + [{"role": "model", "parts": parts}])
        u = data.get("usageMetadata", {})
        return SimpleNamespace(
            id=rid,
            output=[SimpleNamespace(type="function_call", name=p["functionCall"]["name"],
                                    arguments=json.dumps(p["functionCall"].get("args", {})),
                                    call_id=f"{p['functionCall']['name']}:{uuid.uuid4().hex[:8]}")
                    for p in parts if "functionCall" in p],
            output_text="".join(p.get("text", "") for p in parts if not p.get("thought")),
            usage=SimpleNamespace(input_tokens=u.get("promptTokenCount"),
                                  output_tokens=(u.get("candidatesTokenCount") or 0) + (u.get("thoughtsTokenCount") or 0)),
        )

    # -- the two OpenAI-shaped entry points ------------------------------------
    def _parse(self, model, input, text_format):
        r = self._send(model, input, schema=text_format.model_json_schema())
        r.output_parsed = text_format.model_validate_json(r.output_text)
        return r

    def _create(self, model, input, tools=None, previous_response_id=None):
        return self._send(model, input, previous_response_id, tools)
