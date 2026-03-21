FROM node:22-alpine

WORKDIR /app

COPY src ./src

ENV NODE_ENV=production
EXPOSE 9105

CMD ["node", "src/index.js"]
