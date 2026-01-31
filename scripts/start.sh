#!/bin/bash
# Quick start script for LinkX after upstream sync

echo "🚀 Starting LinkX with upstream updates..."
echo ""

# Rebuild images with new Bun/uv dependencies
echo "📦 Building Docker images (this may take a few minutes)..."
docker compose -f compose.yml -f compose.override.yml build --no-cache backend frontend

echo ""
echo "🏃 Starting services..."
docker compose -f compose.yml -f compose.override.yml up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check if Redis is running
echo "🔍 Checking Redis..."
if docker compose -f compose.yml -f compose.override.yml ps redis | grep -q "healthy"; then
    echo "✅ Redis is healthy"
else
    echo "⚠️  Redis may still be starting..."
fi

# Check if backend is running
echo "🔍 Checking Backend..."
if docker compose -f compose.yml -f compose.override.yml ps backend | grep -q "healthy"; then
    echo "✅ Backend is healthy"
else
    echo "⚠️  Backend may still be starting (migrations running)..."
fi

echo ""
echo "🎉 LinkX is starting up!"
echo ""
echo "📱 Frontend: http://localhost:5173"
echo "🔌 Backend API: http://localhost:8000"
echo "📚 API Docs: http://localhost:8000/docs"
echo "🗄️  Adminer (DB): http://localhost:8080"
echo "📧 Mailcatcher: http://localhost:1080"
echo ""
echo "💡 To view logs: docker compose -f compose.yml -f compose.override.yml logs -f"
echo "💡 To stop: docker compose -f compose.yml -f compose.override.yml down"
