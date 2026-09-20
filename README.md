# ScamShield

## Structure

```text
backend/   FastAPI API
frontend/  HTML, CSS and JavaScript client
```

## Run the backend (PowerShell)

```powershell
cd backend
py -m pip install -r requirements.txt
py -m uvicorn app.main:app --reload
```

## Run the frontend

Open `frontend/index.html` with VS Code Live Server. The app calls `http://127.0.0.1:8000/api/analyze`.
