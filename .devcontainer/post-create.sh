#!/bin/bash
set -e

echo "Installing Docker CLI..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.3.1.tgz \
    | sudo tar xz --strip-components=1 -C /usr/local/bin docker/docker
fi

echo "Installing Dagger CLI..."
if ! command -v dagger &>/dev/null; then
  curl -fsSL https://dl.dagger.io/dagger/install.sh | BIN_DIR="$HOME/.local/bin" sh
else
  echo "Dagger already installed: $(dagger version)"
fi

npm install

echo "Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code

echo "Setting up Claude Code auth symlink from persistent volume..."
if [ -f /home/node/.claude/.claude.json ]; then
  ln -sf /home/node/.claude/.claude.json /home/node/.claude.json
else
  echo "No persisted Claude auth found. Set ANTHROPIC_API_KEY or run 'claude' to authenticate."
  echo "cp ~/.claude.json ~/.claude/.claude.json"
fi