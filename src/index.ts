#!/usr/bin/env node

import { WebDriverAgentServer } from './wda.js';

// For backward compatibility
export const createServer = () => {
  const server = new WebDriverAgentServer();
  return server.run();
};

module.exports = { createServer };
