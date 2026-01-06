const socket = io();

// DOM Elements
const landingPage = document.getElementById('landing-page');
const mainApp = document.getElementById('main-app');
const videoContainer = document.getElementById('video-container');
const messagesDiv = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const actionBtn = document.getElementById('actionBtn');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const remotePlaceholder = document.getElementById('remote-placeholder');

// State
let currentMode = null; // 'text' or 'video'
let isConnected = false;
let currentRoomId = null;
let peerConnection = null;
let localStream = null;

// WebRTC Config
const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// ---------------- UI NAVIGATION ----------------

async function startChat(mode) {
    currentMode = mode;
    
    // Hide Landing, Show App
    landingPage.classList.add('hidden');
    mainApp.classList.remove('hidden');
    mainApp.classList.add('flex'); // Ensure flex layout applies

    // Mode Specific Layout
    if (mode === 'text') {
        videoContainer.classList.add('hidden'); // STRICTLY HIDE VIDEO
        videoContainer.classList.remove('flex');
    } else {
        videoContainer.classList.remove('hidden');
        videoContainer.classList.add('flex'); // Show Video
        await setupMedia(); // Get Camera access
    }

    // Immediately trigger "New" search
    handleAction(); 
}

function goHome() {
    location.reload();
}

// ---------------- DEVICE HANDLING ----------------

async function setupMedia() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream = stream;
        localVideo.srcObject = stream;
        populateDevices();
    } catch (err) {
        alert("Camera access denied or missing.");
        goHome();
    }
}

async function populateDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoSelect = document.getElementById('camSelect');
    const audioSelect = document.getElementById('micSelect');
    
    videoSelect.innerHTML = '';
    audioSelect.innerHTML = '';

    devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `${device.kind} - ${device.deviceId.slice(0,5)}`;
        if (device.kind === 'videoinput') videoSelect.appendChild(option);
        if (device.kind === 'audioinput') audioSelect.appendChild(option);
    });
}

function toggleMirror() {
    localVideo.classList.toggle('mirror');
}

// ---------------- CONNECTION LOGIC (STOP / NEW) ----------------

function handleAction() {
    if (isConnected || actionBtn.innerText === "STOP") {
        // --- USER CLICKED STOP ---
        disconnect();
        actionBtn.innerText = "NEW";
        actionBtn.className = "bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition flex items-center gap-2 min-w-[100px] justify-center";
        systemMessage("You stopped the chat.");
    } else {
        // --- USER CLICKED NEW ---
        findStranger();
    }
}

function findStranger() {
    messagesDiv.innerHTML = ''; // Clear chat
    systemMessage("Looking for a stranger...");
    
    actionBtn.innerText = "STOP";
    actionBtn.className = "bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition flex items-center gap-2 min-w-[100px] justify-center";
    
    const interests = document.getElementById('interestInput').value;
    socket.emit('find_partner', { mode: currentMode, interests });
}

function disconnect() {
    isConnected = false;
    currentRoomId = null;
    
    // Disable inputs
    msgInput.disabled = true;
    sendBtn.disabled = true;
    
    // Cleanup WebRTC
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    if(remotePlaceholder) remotePlaceholder.style.display = 'flex';

    socket.emit('leave_room', currentRoomId);
}

// ---------------- SOCKET EVENTS ----------------

socket.on('update_count', (count) => {
    document.getElementById('online-count-landing').innerText = count;
    document.getElementById('chat-online-count').innerText = `${count} online`;
});

socket.on('waiting', (data) => {
    systemMessage(data.message);
});

socket.on('match_found', ({ roomId }) => {
    isConnected = true;
    currentRoomId = roomId;
    systemMessage("Stranger connected! Say hi.");
    
    msgInput.disabled = false;
    sendBtn.disabled = false;
    msgInput.focus();

    if (currentMode === 'video') {
        remotePlaceholder.style.display = 'none';
    }
});

socket.on('partner_disconnected', () => {
    systemMessage("Stranger has disconnected.");
    disconnect(); // Use local disconnect logic to reset state
    // Automatically reset button to NEW
    actionBtn.innerText = "NEW";
    actionBtn.className = "bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition flex items-center gap-2 min-w-[100px] justify-center";
});

// ---------------- WEBRTC LOGIC (Video Only) ----------------

socket.on('make_offer', async () => {
    createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('signal', { room: currentRoomId, type: 'offer', sdp: offer });
});

socket.on('signal', async (data) => {
    if (!peerConnection) createPeerConnection();

    if (data.type === 'offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('signal', { room: currentRoomId, type: 'answer', sdp: answer });
    } 
    else if (data.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } 
    else if (data.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Add local tracks
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    // Handle remote tracks
    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    // Ice Candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { room: currentRoomId, candidate: event.candidate });
        }
    };
}

// ---------------- CHAT LOGIC ----------------

function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    appendMessage('You', text, 'self');
    socket.emit('message', { room: currentRoomId, text });
    msgInput.value = '';
}

socket.on('message', (data) => {
    appendMessage('Stranger', data.text, 'stranger');
});

// Helper: Append Message
function appendMessage(sender, text, type) {
    const div = document.createElement('div');
    // Styling based on sender
    const alignClass = type === 'self' ? 'self-end bg-blue-600 text-white' : 'self-start bg-slate-700 text-slate-200';
    
    div.className = `max-w-[80%] px-4 py-2 rounded-lg text-sm break-words ${alignClass}`;
    div.innerHTML = `<strong>${sender}:</strong> ${text}`; // No redundant report button here
    
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function systemMessage(text) {
    const div = document.createElement('div');
    div.className = "text-center text-slate-500 text-xs italic my-2";
    div.innerText = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function reportUser() {
    if(!isConnected) return;
    alert("User reported to administration.");
}

// --- DRAG AND RESIZE LOGIC ---

const wrapper = document.getElementById('localVideoWrapper');
const resizeHandle = document.getElementById('resizeHandle');
const container = document.getElementById('video-container');

// State variables
let isDragging = false;
let isResizing = false;
let startX, startY, startLeft, startTop, startWidth, startHeight;

// 1. DRAG FUNCTIONALITY
wrapper.addEventListener('mousedown', (e) => {
    // If clicking the resize handle or controls, don't drag
    if (e.target === resizeHandle || e.target.closest('select') || e.target.closest('button')) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    // Get current position
    const rect = wrapper.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // Calculate 'left' and 'top' relative to the container
    startLeft = rect.left - containerRect.left;
    startTop = rect.top - containerRect.top;

    document.body.classList.add('noselect'); // Prevent highlighting text
});

// 2. RESIZE FUNCTIONALITY
resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    e.stopPropagation(); // Stop the drag event from firing
    startX = e.clientX;
    startY = e.clientY;
    
    const rect = wrapper.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;
    
    document.body.classList.add('noselect');
});

// 3. GLOBAL MOUSE MOVE (Handles both)
document.addEventListener('mousemove', (e) => {
    if (!isDragging && !isResizing) return;

    e.preventDefault();

    if (isDragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        // Calculate new position
        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        // Boundaries (Don't let it leave the container)
        const containerRect = container.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();

        const maxLeft = containerRect.width - wrapperRect.width;
        const maxTop = containerRect.height - wrapperRect.height;

        // Clamp values
        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft > maxLeft) newLeft = maxLeft;
        if (newTop > maxTop) newTop = maxTop;

        wrapper.style.left = `${newLeft}px`;
        wrapper.style.top = `${newTop}px`;
        
        // Remove 'bottom' and 'right' classes from Tailwind if they exist 
        // because we are now using explicit top/left
        wrapper.style.bottom = 'auto';
        wrapper.style.right = 'auto';
    }

    if (isResizing) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        let newWidth = startWidth + dx;
        let newHeight = startHeight + dy;

        // Minimum size constraints
        if (newWidth < 100) newWidth = 100;
        if (newHeight < 75) newHeight = 75;

        wrapper.style.width = `${newWidth}px`;
        wrapper.style.height = `${newHeight}px`;
    }
});

// 4. MOUSE UP (Stop everything)
document.addEventListener('mouseup', () => {
    isDragging = false;
    isResizing = false;
    document.body.classList.remove('noselect');
});

// Enter key to send
msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage() });
