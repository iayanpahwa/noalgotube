FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/main.py .
COPY backend/database.py .
COPY frontend/ ./frontend/

ENV FRONTEND_DIR=/app/frontend
ENV DB_PATH=/data/noalgotube.db

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/health')"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
