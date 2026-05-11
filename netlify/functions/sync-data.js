const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  try {
    const store = syncStore();

    if (event.httpMethod === 'GET') {
      const id = event.queryStringParameters?.id || new URLSearchParams(event.rawQuery || '').get('id') || '';
      if (!validId(id)) return json({ error:'Invalid sync id' }, 400);

      const payload = await store.get(id, { type:'json' });
      if (!payload) return json({ error:'No sync data found' }, 404);
      return json({ payload });
    }

    if (event.httpMethod === 'POST') {
      const { id = '', payload = null } = JSON.parse(event.body || '{}');
      if (!validId(id)) return json({ error:'Invalid sync id' }, 400);
      if (!validPayload(payload)) return json({ error:'Invalid sync payload' }, 400);

      const bodySize = JSON.stringify(payload).length;
      if (bodySize > 300000) return json({ error:'Sync payload is too large' }, 413);

      await store.setJSON(id, payload);
      return json({ ok:true });
    }

    return json({ error:'Method not allowed' }, 405);
  } catch (err) {
    console.error(err);
    return json({ error:syncErrorMessage(err) }, 500);
  }
};

function validId(id){
  return /^[a-f0-9]{64}$/.test(id);
}

function validPayload(payload){
  return Boolean(
    payload &&
    payload.version === 1 &&
    typeof payload.salt === 'string' &&
    typeof payload.iv === 'string' &&
    typeof payload.data === 'string'
  );
}

function syncErrorMessage(err){
  const message = err?.message || '';
  const name = err?.name || 'Error';
  if (message.includes('MissingBlobsEnvironmentError')) return 'Add NETLIFY_BLOBS_TOKEN in Netlify environment variables, then redeploy.';
  if (message.includes('Cannot find module') || message.includes('@netlify/blobs')) return 'Sync storage dependency is missing. Redeploy the latest GitHub commit.';
  return `Sync storage failed on the server. ${name}`;
}

function syncStore(){
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) return getStore('rations-sync', { siteID, token });
  return getStore('rations-sync');
}

function json(body, statusCode=200){
  return {
    statusCode,
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  };
}
