const express = require('express');
const admin = require('firebase-admin');
const cookieParser = require('cookie-parser');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const serviceAccount = require('./serviceAccountKey.json');
const port = 8080
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
const readline = require('readline');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
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

app.get('/convert', async (req, res) => {
    try {
        const sessionCookie = req.cookies.session || '';
        if (!sessionCookie) {
            return res.status(401).send('Unauthorized+ Unable to find session cookie.');
        }

        // Verify the session cookie using Firebase Admin SDK
        const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
        // User is authenticated, proceed with the download
        if (!decodedClaims) {
            return res.status(401).send('Unauthorized: Unable to verify session cookie.');
        }
        const videoUrl = req.query.url; // Use req.query to access query parameters
        const videoId = getYouTubeVideoId(videoUrl);

        let stream = ytdl(videoUrl, {
            quality: 'highestaudio',
        });

        let start = Date.now();
        ffmpeg(stream)
            .audioBitrate(128)
            .save(`${__dirname}/storage/${videoId}.mp3`)
            .on('progress', p => {
                readline.cursorTo(process.stdout, 0);
                process.stdout.write(`${p.targetSize}kb downloaded`);
            })
            .on('end', () => {
                console.log(`\ndone, thanks - ${(Date.now() - start) / 1000}s`);
                res.redirect(`/complete/${videoId}`)
            });

    } catch (error) {
        if (error.code === 'auth/session-cookie-expired') {
            return res.status(401).send('Session cookie expired');
        }
        console.error('Error:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/complete/:id', (req, res) => {
    const id = req.params.id;
    res.sendFile(__dirname + '/complete.html');
})

app.get('/download', async (req, res) => {
    const id = req.query.url;

    // Assuming the file name in the storage folder is based on the id
    const fileName = `${id}.mp3`;
    const filePath = path.join(__dirname, 'storage', fileName);

    // Check if the file exists
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            return res.status(404).send('File not found');
        }

        // If the file exists, initiate the download
        res.download(filePath, fileName, (err) => {
            if (err) {
                console.error('Error downloading file:', err);
                res.status(500).send('Internal Server Error');
            }
        });

        // Delete the file after download completes
        // res.on('finish', () => {
        //     fs.unlink(filePath, (err) => {
        //         if (err) {
        //             console.error('Error deleting file:', err);
        //         } else {
        //             console.log('File deleted successfully');
        //         }
        //     });
        // });
    });
});

// Route for /delete
app.post('/delete', async (req, res) => {
    const id = req.query.url;
    const fileName = `${id}.mp3`;
    const filePath = path.join(__dirname, 'storage', fileName);

    // Check if the file exists
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            return res.status(404).send('File not found');
        }

        // If the file exists, delete it
        fs.unlink(filePath, (err) => {
            if (err) {
                console.error('Error deleting file:', err);
                return res.status(500).send('Internal Server Error');
            } else {
                console.log('File deleted successfully');
                return res.status(200).send('File deleted successfully');
            }
        });
    });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
