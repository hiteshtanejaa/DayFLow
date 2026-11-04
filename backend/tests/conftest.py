import os

# app.main configures the database at import time. Tests must never touch a
# real (Supabase) database, whatever .env says: environment variables outrank .env.
os.environ["DATABASE_URL"] = "sqlite://"
