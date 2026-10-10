# Deploy

## Container (servidor próprio)

A imagem é um `nginx:1.27-alpine` com a pasta `web/` copiada e a configuração de `nginx.conf`
(MIME de `.glb`, gzip, cache e `/healthz`).

```bash
docker compose up -d --build     # http://<servidor>:8090
docker compose logs -f
curl http://localhost:8090/healthz
```

Para atualizar depois de mudar o código: `git pull && docker compose up -d --build`.

### Imagem pronta (GHCR)

O workflow `.github/workflows/docker.yml` publica `ghcr.io/mfelipedias/braco-3d` a cada push na `main`
(tags `latest` e `sha-xxxxxxx`) e em tags `v*`.

```bash
docker pull ghcr.io/mfelipedias/braco-3d:latest
docker run -d -p 8090:80 --restart unless-stopped --name braco-3d ghcr.io/mfelipedias/braco-3d:latest
```

### HTTPS e webcam

Navegadores só liberam a câmera em HTTPS ou em `localhost`. Atrás de um proxy (Caddy, Traefik, nginx,
Cloudflare Tunnel, `tailscale serve`), a aplicação funciona sem ajustes, inclusive em subcaminho.

## GitHub Pages

O workflow `.github/workflows/pages.yml` publica a pasta `web/` em
<https://mfelipedias.github.io/braco-3d/> a cada push que altere `web/`. O Pages já entrega HTTPS,
então os gestos funcionam de qualquer lugar.
