const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let textQueue = [];
let videoQueue = [];
let onlineUsers = 0;

io.on('connection', (socket) => {
    onlineUsers++;
    io.emit('update_count', onlineUsers);

    socket.on('find_partner', ({ mode, interests }) => {
        socket.mode = mode; // 'text' or 'video'
        
        // Simple Queue Logic
        let queue = mode === 'text' ? textQueue : videoQueue;

        if (queue.length > 0) {
            // Match found!
            const partner = queue.pop();
            const roomId = `room_${socket.id}_${partner.id}`;
            
            socket.join(roomId);
            partner.join(roomId);

            // Notify both
            io.to(roomId).emit('match_found', { roomId });
            
            // If video, tell them who is initiating
            if (mode === 'video') {
                socket.emit('make_offer', { roomId }); // One side starts WebRTC
            }
        } else {
            // No match, wait in queue
            queue.push(socket);
            socket.emit('waiting', { message: `Looking for a ${mode} partner...` });
        }
    });

    // WebRTC Signaling (Video Mode)
    socket.on('signal', (data) => {
        socket.to(data.room).emit('signal', data);
    });

    // Chat Messages
    socket.on('message', (data) => {
        socket.to(data.room).emit('message', { 
            text: data.text, 
            sender: 'stranger' 
        });
    });

    // Handle Stop/Disconnect
    socket.on('leave_room', (roomId) => {
        if(roomId) {
            socket.to(roomId).emit('partner_disconnected');
            socket.leave(roomId);
        }
        // Remove from queues if they were waiting
        textQueue = textQueue.filter(s => s.id !== socket.id);
        videoQueue = videoQueue.filter(s => s.id !== socket.id);
    });

    socket.on('disconnect', () => {
        onlineUsers--;
        io.emit('update_count', onlineUsers);
        // Clean up queues
        textQueue = textQueue.filter(s => s.id !== socket.id);
        videoQueue = videoQueue.filter(s => s.id !== socket.id);
    });
});

server.listen(3002, () => {
    console.log('Server running on http://localhost:3002');
});
