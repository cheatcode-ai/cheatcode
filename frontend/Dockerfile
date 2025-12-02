FROM node:20-slim AS base

WORKDIR /app

# Install build dependencies for node-gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    build-essential \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Development stage
FROM base AS development

# Copy package files
COPY package*.json ./

RUN npm install

# Copy the frontend code
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]

# Production stage
FROM base AS production

# Copy package files
COPY package*.json ./

RUN npm install

# Copy the frontend code
COPY . .

ENV NEXT_PUBLIC_VERCEL_ENV production

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]