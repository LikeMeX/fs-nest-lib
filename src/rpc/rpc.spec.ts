import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { cmdToRoute } from './cmd-to-route';
import { collectCmds, InternalCmd } from './internal-cmd.decorator';
import { InternalRpcDispatcher } from './internal-rpc.controller';

// ---------------------------------------------------------------------------
// @InternalCmd decorator + dispatch registry
// ---------------------------------------------------------------------------

describe('InternalCmd decorator + InternalRpcDispatcher', () => {
  beforeEach(() => {
    InternalRpcDispatcher._reset();
  });

  class FakeService {
    @InternalCmd('GET_COURSE')
    async getCourse(payload: { id: string }): Promise<{ id: string; title: string }> {
      return { id: payload.id, title: `Course ${payload.id}` };
    }

    @InternalCmd('CREATE_ENROLLMENT')
    async createEnrollment(payload: unknown): Promise<{ ok: boolean }> {
      void payload;
      return { ok: true };
    }
  }

  it('collectCmds extracts all @InternalCmd entries from a class', () => {
    const entries = collectCmds(FakeService);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'GET_COURSE', methodName: 'getCourse' }),
        expect.objectContaining({ cmd: 'CREATE_ENROLLMENT', methodName: 'createEnrollment' }),
      ]),
    );
    expect(entries).toHaveLength(2);
  });

  it('dispatches a registered cmd to its handler method', async () => {
    const svc = new FakeService();
    InternalRpcDispatcher.register(svc, collectCmds(FakeService));

    const result = await InternalRpcDispatcher.dispatch('GET_COURSE', { id: '42' });
    expect(result).toEqual({ id: '42', title: 'Course 42' });
  });

  it('dispatches a second registered cmd correctly', async () => {
    const svc = new FakeService();
    InternalRpcDispatcher.register(svc, collectCmds(FakeService));

    const result = await InternalRpcDispatcher.dispatch('CREATE_ENROLLMENT', {});
    expect(result).toEqual({ ok: true });
  });

  it('throws NotFoundException for an unknown cmd', async () => {
    await expect(InternalRpcDispatcher.dispatch('UNKNOWN_CMD', {})).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException with a message containing the cmd name', async () => {
    await expect(InternalRpcDispatcher.dispatch('MYSTERY_CMD', {})).rejects.toThrow(/MYSTERY_CMD/);
  });
});

// ---------------------------------------------------------------------------
// cmdToRoute mapping
// ---------------------------------------------------------------------------

describe('cmdToRoute', () => {
  // GET with scalar → /:id
  it('GET_COURSE with scalarPayload → GET /internal/course/:id', () => {
    expect(cmdToRoute('GET_COURSE', { scalarPayload: true })).toEqual({
      method: 'GET',
      path: '/internal/course/:id',
      payloadStyle: 'id-param',
    });
  });

  // GET with default (object payload) → query string
  it('GET_COURSE (default) → GET /internal/course (query style)', () => {
    expect(cmdToRoute('GET_COURSE')).toEqual({
      method: 'GET',
      path: '/internal/course',
      payloadStyle: 'query',
    });
  });

  // Multi-word noun → kebab-case
  it('GET_BIZ_MEMBER → GET /internal/biz-member (query style)', () => {
    expect(cmdToRoute('GET_BIZ_MEMBER')).toEqual({
      method: 'GET',
      path: '/internal/biz-member',
      payloadStyle: 'query',
    });
  });

  // Fat query fallback → POST /noun/query
  it('GET_COURSE with fatQuery → POST /internal/course/query', () => {
    expect(cmdToRoute('GET_COURSE', { fatQuery: true })).toEqual({
      method: 'POST',
      path: '/internal/course/query',
      payloadStyle: 'body',
    });
  });

  // Mutations
  it('CREATE_ENROLLMENT → POST /internal/enrollment', () => {
    expect(cmdToRoute('CREATE_ENROLLMENT')).toEqual({
      method: 'POST',
      path: '/internal/enrollment',
      payloadStyle: 'body',
    });
  });

  it('UPDATE_COURSE → PUT /internal/course', () => {
    expect(cmdToRoute('UPDATE_COURSE')).toEqual({
      method: 'PUT',
      path: '/internal/course',
      payloadStyle: 'body',
    });
  });

  it('DELETE_COURSE → DELETE /internal/course', () => {
    expect(cmdToRoute('DELETE_COURSE')).toEqual({
      method: 'DELETE',
      path: '/internal/course',
      payloadStyle: 'body',
    });
  });

  // Multi-word mutation
  it('CREATE_USER_ATTEND_COURSE → POST /internal/user-attend-course', () => {
    expect(cmdToRoute('CREATE_USER_ATTEND_COURSE')).toEqual({
      method: 'POST',
      path: '/internal/user-attend-course',
      payloadStyle: 'body',
    });
  });

  // All-caps noun with many segments
  it('GET_ALL_COURSES_ID → GET /internal/all-courses-id (query style)', () => {
    expect(cmdToRoute('GET_ALL_COURSES_ID')).toEqual({
      method: 'GET',
      path: '/internal/all-courses-id',
      payloadStyle: 'query',
    });
  });
});
