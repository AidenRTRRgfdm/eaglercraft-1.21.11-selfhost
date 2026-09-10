# Eaglercraft 1.21.11 self-host

Run a Paper 1.21.11 world through GDLauncher and connect with Eaglercraft 1.12.2 or Minecraft Java. Velocity, EaglerXServer, ViaVersion, and ViaBackwards handle the connection and version translation.

## Setup on macOS

Requires Node.js 24+ and Java 25+. The launcher can use Java installed by GDLauncher. Set `JAVA_BIN` if it cannot find yours.

1. Download this repository and open Terminal in its folder.
2. On an Apple Silicon Mac, run:

   ```sh
   npm run setup -- --paper --cloudflared
   ```

   This downloads the pinned JARs and tunnel client, checks their SHA256 hashes, and creates the proxy configuration. It preserves existing configuration. No npm dependencies are needed. For Intel Macs or other systems, omit `--cloudflared` and install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) separately.

3. In GDLauncher's **Servers**, create a **1.21.11** server. Stop it before changing files. Open its server folder and replace the JAR it launches with `backend/paper-1.21.11-132.jar`, keeping the original launch filename. GDLauncher may still label the server Vanilla. Do not use Reinstall afterward: that would replace Paper.
4. Read the [Minecraft EULA](https://www.minecraft.net/eula). If you agree, accept it through GDLauncher or set `eula=true` in the backend's `eula.txt`. Start the backend once to generate Paper's configuration, then stop it.
5. Edit these entries in the backend folder. Keep the other settings:

   `server.properties`:

   ```properties
   server-ip=127.0.0.1
   server-port=25566
   online-mode=false
   enforce-secure-profile=false
   motd=pizza smp
   ```

   `spigot.yml`:

   ```yaml
   settings:
     bungeecord: true
   ```

   `config/paper-global.yml`:

   ```yaml
   proxies:
     bungee-cord:
       online-mode: false
     velocity:
       enabled: false
   ```

   Add these values under the existing sections, without creating duplicate sections. This setup uses legacy forwarding for older clients. Keep backend port **25566 private**; offline usernames are not verified with Microsoft.

## Start and join

1. Start the Paper server in GDLauncher.
2. Double-click **Start Bridge.command**, or run `npm start`. Keep its terminal open.
3. For a secure browser address, double-click **Start Public Link.command**. Copy the displayed `https://…trycloudflare.com` address and change `https://` to **`wss://`** when adding it in Eaglercraft.

| Client | Address |
| --- | --- |
| Java on the same Mac | `127.0.0.1:25565` |
| Eaglercraft locally | `ws://127.0.0.1:25565` |
| Eaglercraft from an HTTPS page or outside your Wi-Fi | The temporary `wss://…trycloudflare.com` address |

HTTPS pages may block local `ws://` connections; use the secure address in that case. The temporary address changes when the tunnel restarts and carries Eaglercraft WebSockets, not regular Java TCP connections. Keep the Mac awake while hosting.

If cloudflared is installed separately, run `cloudflared tunnel --url http://127.0.0.1:25565 --no-autoupdate` instead of the public-link command file.

To stop, press Ctrl+C in the tunnel terminal, type `end` in the bridge terminal, and stop the backend in GDLauncher.

The world runs 1.21.11, but the Eaglercraft client remains 1.12.2. New content uses older substitutes, and that client cannot access world height outside Y=0–255.

## Files

- `Server.js`: starts and stops the Java proxy.
- `package.json`: `npm start`, `npm run setup`, and `npm run check`. npm requires the lowercase filename.
- `Bootstrap.js`: downloads the versions listed in `proxy-downloads.json`, `paper-download.json`, and `cloudflared-source.json`.
- `config-templates.json`: proxy and plugin settings, written on setup only when missing. Server identifiers and secrets are generated locally on first start.
- `Dockerfile`: optional bridge container. The Paper backend stays separate.

Set `PROXY_MEMORY_MB` to change the bridge heap (default 512). `BACKEND_HOST` and `BACKEND_PORT` override and save the backend address in `proxy/velocity.toml`.

## Docker

Run setup before building so the proxy JARs and configuration exist:

```sh
npm run setup
docker build -t eaglercraft-bridge:1.21.11 .
docker run --name eaglercraft-bridge -it --stop-timeout 40 \
  -p 25565:25565 \
  --mount type=volume,src=eaglercraft-proxy,dst=/app/proxy \
  -e BACKEND_HOST=host.docker.internal \
  -e BACKEND_PORT=25566 \
  eaglercraft-bridge:1.21.11
```

Stop the native bridge first. With Docker Desktop, the backend must bind to a Mac address reachable by the container; a loopback-only backend may be unreachable. Restrict 25566 to trusted local access. The native setup avoids that networking change. On Linux, supply a reachable backend host instead of `host.docker.internal`.

The named volume retains proxy files across restarts and image rebuilds. Update its JARs explicitly when upgrading. Docker build and runtime have not been tested.

## Sources

- [Original hosting guide](https://github.com/dragon731012/Eaglercraft-1.12-Server-Hosting)
- [Paper and Velocity](https://papermc.io/)
- [EaglerXServer](https://github.com/lax1dude/eaglerxserver)
- [ViaVersion](https://github.com/ViaVersion/ViaVersion) and [ViaBackwards](https://github.com/ViaVersion/ViaBackwards)
- [Cloudflared](https://github.com/cloudflare/cloudflared)

Third-party binaries are downloaded from their publishers and retain their own licenses. Worlds, player data, logs, local credentials, and downloaded binaries are excluded from this repository.
