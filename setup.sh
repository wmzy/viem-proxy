#!/bin/bash

echo "🚀 Setting up viem-proxy project..."

# 安装根目录依赖
echo "📦 Installing root dependencies..."
pnpm install --prefer-offline --registry=https://registry.npmmirror.com

# 安装 workers 依赖
echo "📦 Installing workers dependencies..."
cd workers
pnpm install --prefer-offline --registry=https://registry.npmmirror.com
cd ..

echo "✅ Setup completed!"
echo ""
echo "🔧 Available commands:"
echo "  npm run dev     - Start development mode"
echo "  npm run build   - Build the project"
echo "  npm run test    - Run tests"
echo "  npm run lint    - Run linter"
echo ""
echo "🌐 Workers commands (in workers/ directory):"
echo "  npm run dev     - Start workers development"
echo "  npm run deploy  - Deploy to Cloudflare"
echo ""
echo "📚 Next steps:"
echo "  1. Configure workers/wrangler.toml with your Cloudflare settings"
echo "  2. Run 'npm run build' to build the project"
echo "  3. Run 'npm test' to verify everything works"
