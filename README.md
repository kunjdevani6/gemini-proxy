# Gemini MCQ Proxy

Serverless proxy for Google Gemini MCQ generation. Used by MyStudyPortal when hosting blocks direct outbound Gemini API calls (e.g. InfinityFree).

## Environment variables (set in Vercel, not in code)

- `GEMINI_API_KEY` — your Google Gemini API key
- `GEMINI_MODEL` — optional, defaults to `gemini-2.5-flash`

## Local test (after deploy)

```bash
curl -X POST "https://YOUR-PROJECT.vercel.app/api/generate-mcq" \
  -H "Content-Type: application/json" \
  -d "{\"subject\":\"Data Structures\",\"level\":\"easy\",\"count\":5}"
```
