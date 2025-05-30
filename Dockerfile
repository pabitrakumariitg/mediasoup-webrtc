FROM node:20-bookworm-slim

WORKDIR /app

# Update package sources and install build dependencies
RUN echo "deb http://deb.debian.org/debian bookworm main" > /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian bookworm-updates main" >> /etc/apt/sources.list && \
    echo "deb http://security.debian.org/debian-security bookworm-security main" >> /etc/apt/sources.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better layer caching
COPY package*.json ./

# Install npm dependencies
RUN npm install --production=false

# Copy application files
COPY src/ ./src/
COPY ssl/ ./ssl/
COPY public/ ./public/

# Expose ports
EXPOSE 3016
EXPOSE 10000-10100/udp

# Install nodemon globally for development
RUN npm install -g nodemon

# Start command
CMD ["npm", "start"]