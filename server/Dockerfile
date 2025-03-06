FROM node:22.14-alpine

WORKDIR /server

COPY package*.json ./

RUN npm ci

COPY . .

CMD [ "npm", "run", "dev" ]