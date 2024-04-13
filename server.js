const express = require('express');
const admin = require('firebase-admin');
const cookieParser = require('cookie-parser');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
require('dotenv').config()

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
const readline = require('readline');

const port = 8080

admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS))
});

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

function getYouTubeVideoId(url) {
    const pattern = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(pattern);
    return match && match[1];
}

// Serve the login HTML file
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

// Main page route
app.get('/main', (req, res) => {
    const sessionCookie = req.cookies.session || '';
    admin.auth().verifySessionCookie(sessionCookie, true)
        .then(() => {
            res.sendFile(__dirname + '/main.html');
        })
        .catch(() => {
            res.redirect('/');
        });
});

// Token verification route
app.post('/verifyToken', async (req, res) => {
    const idToken = req.body.token;
    admin.auth().verifyIdToken(idToken)
        .then((decodedToken) => {
            // Create a session cookie and set it in the response
            return admin.auth().createSessionCookie(idToken, { expiresIn: 60 * 60 * 24 * 5 });
        })
        .then((sessionCookie) => {
            res.cookie('session', sessionCookie, { maxAge: 60 * 60 * 24 * 1000, httpOnly: true });
            res.json({ valid: true });
        })
        .catch(() => {
            res.json({ valid: false });
        });
});

app.post('/logout', (req, res) => {
    res.clearCookie('session');
    res.redirect('/');
});

// Convert route with authentication check
app.get('/convert', async (req, res) => {
    const sessionCookie = req.cookies.session || '';
    admin.auth().verifySessionCookie(sessionCookie, true)
        .then(() => {
            // User is authenticated, proceed with the conversion
            try {
                const videoUrl = req.query.url; // Use req.query to access query parameters
                const videoId = getYouTubeVideoId(videoUrl);

                let stream = ytdl(videoUrl, {
                    quality: 'highestaudio',
                });

                let start = Date.now();
                ffmpeg(stream)
                    .audioBitrate(128)
                    .format('mp3')
                    .on('end', () => {
                        console.log(`Conversion done, thanks - ${(Date.now() - start) / 1000}s`);
                    })
                    .pipe(res.attachment(`${videoId}.mp3`)) // Suggest filename for download
                    .on('finish', () => {
                        console.log('File sent to client');
                    });

            } catch (error) {
                console.error('Error:', error);
                res.status(500).send('Internal Server Error');
            }
        })
        .catch(() => {
            // User is not authenticated, redirect to login page
            res.redirect('/');
        });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
