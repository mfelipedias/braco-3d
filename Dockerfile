FROM nginx:1.27-alpine
LABEL org.opencontainers.image.title="braco-3d" \
      org.opencontainers.image.description="Simulador 3D de braço robótico com controle por teclado e gestos" \
      org.opencontainers.image.source="https://github.com/mfelipedias/braco-3d"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/ /usr/share/nginx/html/
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
EXPOSE 80
