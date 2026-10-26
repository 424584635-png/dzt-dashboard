import { getStore } from '@netlify/blobs';
export const handler = async () => {
  const store = getStore('dzt');
  const data = await store.get('data', { type: 'json' });
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data || { meta: {}, riders: [] })
  };
};
