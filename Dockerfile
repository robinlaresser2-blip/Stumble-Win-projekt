# Backend StumbleShadow (Peak 0.64 pe Supabase) — imagine Node
FROM node:18-alpine

WORKDIR /app

# Instaleaza dependintele (cache pe package.json)
COPY package*.json ./
RUN npm install --omit=dev

# Copiaza restul codului
COPY . .

# Render injecteaza PORT prin env; index.js asculta pe process.env.PORT
EXPOSE 8080

CMD ["node", "index.js"]
