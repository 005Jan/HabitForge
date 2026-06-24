FROM nginx:alpine

# Configuració de nginx amb proxy al backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Fitxers estàtics del frontend
COPY public/ /usr/share/nginx/html/

EXPOSE 80
