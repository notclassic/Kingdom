const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

// Variables de entorno
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const ASSEMBLYAI_KEY   = process.env.ASSEMBLYAI_KEY;
const GROQ_KEY         = process.env.GROQ_API_KEY;
const GH_TOKEN         = process.env.GITHUB_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const REPO_OWNER = process.env.GITHUB_OWNER || 'notclassic';
const REPO_NAME  = process.env.GITHUB_REPO || 'Kingdom';
const BRANCH     = 'main';
const FILE_PATH  = 'data.json';
const TG = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN;

// Ruta de salud (para que Render sepa que está vivo)
app.get('/', (req, res) => res.send('✅ Kingdom Bot está despierto y funcionando.'));

// --- FUNCIONES DE GITHUB ---
async function getData() {
  const api = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + FILE_PATH;
  const headers = { authorization: 'Bearer ' + GH_TOKEN, accept: 'application/vnd.github+json' };
  const res = await fetch(api + '?ref=' + BRANCH, { headers });
  if (!res.ok) return null;
  const file = await res.json();
  return { sha: file.sha, data: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')) };
}

async function saveData(fileSha, newData, commitMsg) {
  const api = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + FILE_PATH;
  const headers = { authorization: 'Bearer ' + GH_TOKEN, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: commitMsg,
      content: Buffer.from(JSON.stringify(newData, null, 2)).toString('base64'),
      sha: fileSha,
      branch: BRANCH
    })
  });
}

// --- FUNCIONES DE TELEGRAM ---
async function sendMsg(text) {
  await fetch(TG + '/sendMessage