# Use Node.js official parent image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and lockfile
COPY package.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Build Next.js application
RUN npm run build

# Expose port
EXPOSE 3000

# Start production server
CMD ["npm", "run", "start"]
