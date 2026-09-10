#!/bin/zsh
set -eu
cd -- "${0:A:h}"
print 'Start the Minecraft server in GDLauncher and Start Bridge.command first.'
print 'This creates a new temporary public Eaglercraft address.'
print 'Use the displayed trycloudflare.com hostname with wss:// in Eaglercraft.'
print 'Keep this window open. Press Ctrl+C to stop the public link.'
exec ./bin/cloudflared tunnel --url http://127.0.0.1:25565 --no-autoupdate
