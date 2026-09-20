import json
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from groq import Groq
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
app = FastAPI(title="ScamShield API", version="2.0.0")


class ScanRequest(BaseModel):
    message: str = Field(min_length=1, max_length=5000)


RULES = [
    (r"\b(otp|cvv|upi pin|password|login details)\b", 28, "Requests sensitive credentials", "The message asks for information that should never be shared.", "🔐"),
    (r"https?://[^\s]+", 20, "Contains an external link", "Scam messages often use links that imitate trusted brands.", "🔗"),
    (r"\b(urgent|immediately|today|within \d+|last warning|act now|blocked)\b", 14, "Uses urgency or pressure", "Pressure is commonly used to stop people from verifying a claim.", "⏱️"),
]


def rule_analysis(message: str) -> dict:
    score, findings = 0, []
    for pattern, points, title, text, icon in RULES:
        if re.search(pattern, message, re.I):
            score += points
            findings.append({"title": title, "text": text, "icon": icon})
    if re.search(r"\.(xyz|top|click|live|site|shop)(\b|/)", message, re.I):
        score += 18
        findings.append({"title": "Potentially risky web domain", "text": "Unusual domains need verification before opening.", "icon": "🌐"})
    score = min(score, 100)
    return {"score": score, "level": "Dangerous" if score >= 60 else "Suspicious" if score >= 30 else "Low risk", "findings": findings, "advice": ["Do not share OTPs, PINs, passwords, or card details.", "Verify the sender using an official website or app.", "Avoid clicking unfamiliar links."], "engine": "Rule fallback"}


def ai_analysis(message: str) -> dict:
    prompt = f"""Analyze this message for phishing, fraud, impersonation, malicious links,
credential theft, fake jobs, financial scams, and social engineering. Return JSON with score
(integer 0-100), level (Low risk, Suspicious, or Dangerous), findings (objects with title, text,
and icon), and advice (strings). Be concise, do not invent facts, and use only this message:\n\n{message}"""
    response = Groq(api_key=os.environ["GROQ_API_KEY"]).chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "system", "content": "You are a careful, concise security analyst. Return strict JSON only."}, {"role": "user", "content": prompt}],
        response_format={"type": "json_object"}, temperature=0.1, max_tokens=700,
    )
    result = json.loads(response.choices[0].message.content)
    score = max(0, min(100, int(result["score"])))
    return {
        "score": score,
        "level": result["level"] if result.get("level") in {"Low risk", "Suspicious", "Dangerous"} else ("Dangerous" if score >= 60 else "Suspicious" if score >= 30 else "Low risk"),
        "findings": [{"title": str(item["title"]), "text": str(item["text"]), "icon": str(item.get("icon", "⚠️"))} for item in result["findings"] if isinstance(item, dict) and "title" in item and "text" in item],
        "advice": [str(item) for item in result["advice"]],
        "engine": "Groq AI",
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "ai_enabled": bool(os.getenv("GROQ_API_KEY"))}


@app.post("/api/analyze")
def analyze(payload: ScanRequest):
    if os.getenv("GROQ_API_KEY"):
        try:
            return ai_analysis(payload.message)
        except Exception:
            pass
    return rule_analysis(payload.message)


app.mount("/", StaticFiles(directory=Path(__file__).resolve().parents[2] / "frontend", html=True), name="frontend")
