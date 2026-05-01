# AI Gateway - Unified AI API Platform

A high-performance AI API Gateway platform (similar to OpenRouter/Together AI) that acts as middleware between users and AI model providers. Users get a single API key to access multiple AI models through an OpenAI-compatible API.

## Features

- **OpenAI-Compatible API** - Drop-in replacement, just change base URL and API key
- **Key Pool System** - Manage hundreds/thousands of provider API keys behind a single user key
- **Load Balancing** - Round Robin, Least Used, Random Weighted algorithms
- **Automatic Failover** - Instant switching to next key/provider on 429, timeout, or errors
- **Key Rotation** - Automatic cooldown and rotation to avoid rate limits
- **Multi-Provider Support** - Connect MegaLLM, OpenAI, and custom providers
- **Pay-Per-Token Billing** - Token-based usage tracking and billing
- **Admin Dashboard** - Full management of providers, keys, models, and users

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Supabase credentials and API keys
```

### 3. Setup Database

The app uses Supabase PostgreSQL. Run the SQL schema in your Supabase dashboard or use the setup script:

```bash
bun run setup-db.ts
```

### 4. Run Development Server

```bash
bun run dev
```

## API Usage

### OpenAI-Compatible Endpoint

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-gateway.com/v1",
    api_key="sk-live-xxxxxxxx"
)

# Chat completion
response = client.chat.completions.create(
    model="deepseek-v3.1",
    messages=[{"role": "user", "content": "Hello!"}]
)

# Streaming
response = client.chat.completions.create(
    model="deepseek-v3.1",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)
```

### Supported Model Aliases

| Alias | Full Model Name |
|-------|----------------|
| `deepseek-v3.1` | `deepseek-ai/deepseek-v3.1-terminus` |
| `gpt-oss-120b` | `openai-gpt-oss-120b` |
| `gpt-oss-20b` | `openai-gpt-oss-20b` |

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI-compatible chat completions |
| `GET /v1/models` | List available models |
| `POST /api/auth/register` | Register new account |
| `POST /api/auth/login` | Login |
| `GET /api/keys` | Manage API keys |
| `GET /api/user/usage` | Usage statistics |
| `GET /api/user/balance` | Balance and transactions |

## Architecture

```
User Request → API Gateway → Key Pool Selection → Provider API
                    ↓                                    ↓
              Auth & Billing                    Response / Failover
```

## Tech Stack

- **Frontend**: Next.js 16, React, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes, Server Actions
- **Database**: Supabase PostgreSQL
- **Auth**: JWT + API Key authentication
- **Deployment**: Vercel / Docker

## Default Admin

- Email: `admin@aigateway.com`
- Password: `admin123`

**⚠️ Change the admin password immediately after first login!**

## License

MIT
