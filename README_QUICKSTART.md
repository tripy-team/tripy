# Quick Start Guide

## 🚀 Start Everything at Once

To start both backend and frontend servers together:

```bash
./start_dev.sh
```

Or using npm (after installing dependencies):

```bash
npm install
npm run dev
```

This will:
- ✅ Start backend on http://localhost:8000
- ✅ Start frontend on http://localhost:3000
- ✅ Show logs from both servers
- ✅ Stop both when you press Ctrl+C

## 📋 What Gets Started

### Backend (FastAPI)
- **URL**: http://localhost:8000
- **Health Check**: http://localhost:8000/healthz
- **API Docs**: http://localhost:8000/docs

### Frontend (Next.js)
- **URL**: http://localhost:3000
- Opens automatically in your browser

## 🔧 Manual Start (If Needed)

If you prefer to run servers separately:

### Backend Only
```bash
cd backend
./start_server.sh
```

### Frontend Only
```bash
cd frontend
npm run dev
```

## 📝 Prerequisites

Before running `start_dev.sh`:

1. **Backend `.env` configured**:
   - DynamoDB table names
   - Cognito credentials (for auth)
   - AWS region

2. **Frontend `.env.local` configured**:
   - `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000`

3. **Dependencies installed**:
   ```bash
   # Backend
   cd backend && pip install -r requirements.txt
   
   # Frontend
   cd frontend && npm install
   ```

## 🐛 Troubleshooting

### "Cannot connect to backend server"
- Make sure backend is running: `curl http://localhost:8000/healthz`
- Check `frontend/.env.local` has correct `NEXT_PUBLIC_BACKEND_URL`
- Verify backend `.env` file is configured correctly

### "Port already in use"
- Backend (8000): Kill process using `lsof -ti:8000 | xargs kill -9`
- Frontend (3000): Kill process using `lsof -ti:3000 | xargs kill -9`
- Or change ports in respective config files

### Backend won't start
- Check `backend/.env` has all required variables
- Run `cd backend && python3 test_config.py` to verify config
- Ensure Python dependencies are installed: `pip install -r requirements.txt`

## 🎯 Next Steps

1. **Run the script**: `./start_dev.sh`
2. **Open browser**: http://localhost:3000
3. **Test signup**: http://localhost:3000/register
4. **Test login**: http://localhost:3000/login

Both servers will automatically reload on code changes!
