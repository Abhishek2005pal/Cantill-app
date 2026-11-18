import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from './app.js';

describe('API health', () => {
  it('returns a healthy service without requiring MongoDB', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
