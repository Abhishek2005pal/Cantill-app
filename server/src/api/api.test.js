import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../app.js';

describe('API contracts', () => {
  it('exposes health through supertest', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true });
  });

  it('rejects a batch without a file or batch id', async () => {
    const response = await request(app).post('/api/process-batch');
    expect(response.status).toBe(400);
    expect(response.body.errors[0].message).toContain('CSV file');
  });

  it('requires an override comment', async () => {
    const response = await request(app).post('/api/requirements/000000000000000000000000/override').send({ comment: '  ' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('comment');
  });
});
