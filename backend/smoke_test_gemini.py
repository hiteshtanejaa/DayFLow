"""One-off connectivity check for the OpenAI integration.

(Filename kept from the earlier Gemini attempt — content now targets
OpenAI. Rename to smoke_test_openai.py if you want that cleaned up.)

Run from backend/ after backend/.env has OPENAI_API_KEY set:

    python smoke_test_gemini.py

Never prints the key itself — only confirms the settings loaded a
non-empty value, then shows the model's actual response text.
"""
from app.config import get_settings
from app.agents.pipeline import extract_intent
from app.models.schemas import OrchestrationMode

settings = get_settings()
if not settings.openai_api_key:
    raise SystemExit(
        "OPENAI_API_KEY is empty. Set it in backend/.env, then re-run this script."
    )
print(f"Key loaded (length {len(settings.openai_api_key)} chars). Model: {settings.openai_model}")

transcript = (
    "I have interview prep, gym, and coursework today, but I am feeling pretty tired."
)
print(f"\nSending test transcript to OpenAI:\n  {transcript!r}\n")

result, log = extract_intent(transcript, OrchestrationMode.REACT)

print(f"Latency: {log.latency_ms:.0f}ms")
print(f"Energy level extracted: {result.user_energy_level}")
print(f"Context flags: {result.context_flags}")
print("Tasks extracted:")
for t in result.tasks:
    print(f"  - {t.title} ({t.duration_minutes} min, energy={t.energy_required}, priority={t.priority})")

print("\nSMOKE TEST PASSED — OpenAI structured-output call round-tripped correctly.")
