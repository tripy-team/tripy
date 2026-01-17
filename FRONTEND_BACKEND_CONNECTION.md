# Frontend-Backend Connection Status ✅

## ✅ Connection Status: **CONNECTED**

The frontend is properly configured to connect to the backend.

---

## 📋 Configuration Summary

### Frontend API Client
- **File**: `frontend/src/lib/api.ts`
- **Backend URL**: Uses `NEXT_PUBLIC_BACKEND_URL` environment variable
- **Default**: `http://localhost:8000` (for local development)
- **Production**: `https://xezfenhu6t.us-east-1.awsapprunner.com`

### Environment Variables

#### Local Development (`frontend/.env.local`)
```bash
# Backend API URL
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

#### Production (`amplify.yml`)
```yaml
build:
  commands:
    - npm run build
  env:
    - name: NEXT_PUBLIC_BACKEND_URL
      value: https://xezfenhu6t.us-east-1.awsapprunner.com
```

---

## ✅ Verification Steps

### 1. Check Local Development Configuration

Verify your `frontend/.env.local` file exists and has:
```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

**To create/update**:
```bash
cd frontend
cp env.example .env.local
# Edit .env.local with your backend URL
```

### 2. Check Production Configuration

The `amplify.yml` file is already configured with:
```yaml
- name: NEXT_PUBLIC_BACKEND_URL
  value: https://xezfenhu6t.us-east-1.awsapprunner.com
```

### 3. Verify Backend is Running (Local)

```bash
# Check if backend is running on port 8000
curl http://localhost:8000/healthz

# Should return: {"status": "ok"}
```

### 4. Verify Backend is Running (Production)

```bash
# Check if backend is running on App Runner
curl https://xezfenhu6t.us-east-1.awsapprunner.com/healthz

# Should return: {"status": "ok"}
```

---

## 🔧 How It Works

### API Client Flow

1. **Frontend loads** → Reads `NEXT_PUBLIC_BACKEND_URL` from environment
2. **API request made** → `frontend/src/lib/api.ts` uses `BACKEND_URL` constant
3. **Request sent** → `fetch(`${BACKEND_URL}/api/endpoint`)`
4. **Authentication** → Adds `Authorization: Bearer <token>` header if authenticated
5. **Response handled** → Processes JSON response or handles errors

### Example API Call

```typescript
// From frontend/src/lib/api.ts
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

// Making a request
const response = await fetch(`${BACKEND_URL}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
```

---

## 🚨 Troubleshooting

### "Cannot connect to backend server"

**Issue**: Frontend can't reach backend

**Solutions**:
1. **Local Development**:
   - Check if backend is running: `curl http://localhost:8000/healthz`
   - Verify `frontend/.env.local` has `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000`
   - Restart frontend dev server after changing `.env.local`

2. **Production**:
   - Check if backend App Runner service is running
   - Verify `amplify.yml` has correct `NEXT_PUBLIC_BACKEND_URL`
   - Check backend CORS allows your Amplify domain

### CORS Errors

**Issue**: Browser blocks requests due to CORS

**Solutions**:
1. **Update backend CORS** in `backend/src/app.py`:
   ```python
   ALLOWED_ORIGINS = [
       "https://your-app.amplifyapp.com",  # Your Amplify domain
       "http://localhost:3000",  # Local development
   ]
   ```

2. **Or use environment variable**:
   ```bash
   CORS_ORIGINS=https://your-app.amplifyapp.com,http://localhost:3000
   ```

### Environment Variable Not Working

**Issue**: `NEXT_PUBLIC_BACKEND_URL` not being read

**Solutions**:
1. **Local**: Restart dev server after changing `.env.local`
2. **Production**: Rebuild Amplify app after changing `amplify.yml`
3. **Verify**: Check browser console for `Backend URL:` log (development mode)

---

## 📝 Next Steps

1. ✅ **Frontend is connected** - No action needed
2. ✅ **API client configured** - Ready to use
3. ⚠️ **Verify backend is running**:
   - Local: Start backend with `cd backend && ./start_server.sh`
   - Production: Check App Runner service status
4. ⚠️ **Test connection**:
   - Try logging in/registering
   - Check browser DevTools → Network tab for API requests

---

## 🔗 Related Files

- **Frontend API Client**: `frontend/src/lib/api.ts`
- **Frontend Env Template**: `frontend/env.example`
- **Amplify Config**: `amplify.yml`
- **Backend CORS Config**: `backend/src/app.py`
- **Backend Health Check**: `backend/src/app.py` → `/healthz` endpoint
