if (location.href.substr(0, 5) !== 'https') location.href = 'https' + location.href.substr(4, location.href.length - 4)

const socket = io()

let producer = null

// Generate a random username
nameInput.value = 'user_' + Math.round(Math.random() * 1000)

// Get all UI elements
const profileSetup = document.getElementById('profileSetup')
const roomOptions = document.getElementById('roomOptions')
const createRoomForm = document.getElementById('createRoomForm')
const joinRoomForm = document.getElementById('joinRoomForm')
const control = document.getElementById('control')
const videoMedia = document.getElementById('videoMedia')

socket.request = function request(type, data = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(type, data, (data) => {
      if (data.error) {
        reject(data.error)
      } else {
        resolve(data)
      }
    })
  })
}

let rc = null

function joinRoom(name, room_id) {
  if (rc && rc.isOpen()) {
    console.log('Already connected to a room')
  } else {
    // Wait for device enumeration before creating RoomClient
    initEnumerateDevices().then(() => {
      console.log('Devices enumerated, creating RoomClient')
      rc = new RoomClient(localMedia, remoteVideos, remoteAudios, window.mediasoupClient, socket, room_id, name, window.profileImageDataUrl, roomOpen)
      addListeners()
    }).catch(err => {
      console.error('Error initializing devices:', err)
      // Create RoomClient anyway to allow joining without media
      rc = new RoomClient(localMedia, remoteVideos, remoteAudios, window.mediasoupClient, socket, room_id, name, window.profileImageDataUrl, roomOpen)
      addListeners()
    })
  }
}

function roomOpen() {
  // Hide all UI step elements
  hide(profileSetup)
  hide(roomOptions)
  hide(createRoomForm)
  hide(joinRoomForm)
  
  // Hide start buttons and show stop buttons as we'll auto-start both
  hide(startAudioButton)
  reveal(stopAudioButton)
  hide(startVideoButton)
  reveal(stopVideoButton)
  reveal(startScreenButton)
  hide(stopScreenButton)
  reveal(exitButton)
  reveal(copyButton)
  reveal(devicesButton)
  control.className = ''
  reveal(videoMedia)

  // Automatically start audio and video
  setTimeout(() => {
    // We use setTimeout to ensure the UI is ready before starting media
    if (rc) {
      // Start audio
      if (!rc.producerLabel.has(RoomClient.mediaType.audio)) {
        const audioSelect = document.getElementById('audioSelect')
        rc.produce(RoomClient.mediaType.audio, audioSelect.value)
      }
      
      // Start video
      if (!rc.producerLabel.has(RoomClient.mediaType.video)) {
        const videoSelect = document.getElementById('videoSelect')
        rc.produce(RoomClient.mediaType.video, videoSelect.value)
      }
    }
  }, 1000) // Wait 1 second to ensure everything is initialized
}

function hide(elem) {
  elem.className = 'hidden'
}

function reveal(elem) {
  elem.className = ''
}

function addListeners() {
  rc.on(RoomClient.EVENTS.startScreen, () => {
    hide(startScreenButton)
    reveal(stopScreenButton)
  })

  rc.on(RoomClient.EVENTS.stopScreen, () => {
    hide(stopScreenButton)
    reveal(startScreenButton)
  })

  rc.on(RoomClient.EVENTS.stopAudio, () => {
    hide(stopAudioButton)
    reveal(startAudioButton)
  })
  rc.on(RoomClient.EVENTS.startAudio, () => {
    hide(startAudioButton)
    reveal(stopAudioButton)
  })

  rc.on(RoomClient.EVENTS.startVideo, () => {
    hide(startVideoButton)
    reveal(stopVideoButton)
  })
  rc.on(RoomClient.EVENTS.stopVideo, () => {
    hide(stopVideoButton)
    reveal(startVideoButton)
  })
  rc.on(RoomClient.EVENTS.exitRoom, () => {
    // Hide video conference elements
    hide(control)
    hide(devicesList)
    hide(videoMedia)
    hide(copyButton)
    hide(devicesButton)
    
    // Reset URL to remove room info
    window.history.replaceState({}, '', '/')
    
    // Show profile setup screen again
    reveal(profileSetup)
  })
}

let isEnumerateDevices = false

function initEnumerateDevices() {
  // Many browsers, without the consent of getUserMedia, cannot enumerate the devices.
  if (isEnumerateDevices) return Promise.resolve() // Return resolved promise if already enumerated

  const constraints = {
    audio: true,
    video: true
  }

  return navigator.mediaDevices
    .getUserMedia(constraints)
    .then((stream) => {
      return enumerateDevices().then(() => {
        stream.getTracks().forEach(function (track) {
          track.stop()
        })
      })
    })
    .catch((err) => {
      console.error('Access denied for audio/video: ', err)
      return Promise.resolve() // Continue even if there's an error
    })
}

function enumerateDevices() {
  return new Promise((resolve) => {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      devices.forEach((device) => {
        let el = null
        if ('audioinput' === device.kind) {
          el = audioSelect
        } else if ('videoinput' === device.kind) {
          el = videoSelect
        }
        if (!el) return

        let option = document.createElement('option')
        option.value = device.deviceId
        option.innerText = device.label
        el.appendChild(option)
        isEnumerateDevices = true
      })
      resolve()
    })
  })
}

// Notification bar
function showNotification(message) {
  let notif = document.getElementById('notification-bar')
  if (!notif) {
    notif = document.createElement('div')
    notif.id = 'notification-bar'
    notif.style.position = 'fixed'
    notif.style.top = '0'
    notif.style.left = '0'
    notif.style.width = '100%'
    notif.style.background = '#007bff'
    notif.style.color = 'white'
    notif.style.textAlign = 'center'
    notif.style.padding = '10px'
    notif.style.zIndex = '9999'
    notif.style.fontWeight = 'bold'
    notif.style.fontSize = '16px'
    document.body.appendChild(notif)
  }
  notif.textContent = message
  notif.style.display = 'block'
  setTimeout(() => {
    notif.style.display = 'none'
  }, 3000)
}

socket.on('notification', (data) => {
  if (data && data.message) {
    showNotification(data.message)
  }
})

window.profileImageDataUrl = null

const profileImageInput = document.getElementById('profileImageInput')
const uploadProfileImageButton = document.getElementById('uploadProfileImageButton')
const profileImagePreview = document.getElementById('profileImagePreview')

uploadProfileImageButton.onclick = function() {
  profileImageInput.click()
}
profileImageInput.onchange = function(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = function(evt) {
    window.profileImageDataUrl = evt.target.result
    profileImagePreview.src = window.profileImageDataUrl
    profileImagePreview.style.display = 'block'
  }
  reader.readAsDataURL(file)
}

// Step navigation functions
function continueToRoomOptions() {
  const name = nameInput.value
  if (!name) {
    alert('Please enter your name!')
    return false;
  }
  if (!window.profileImageDataUrl) {
    alert('Please upload a profile image!')
    return false;
  }
  hide(profileSetup)
  reveal(roomOptions)
  return true;
}

function showCreateRoomForm() {
  hide(roomOptions)
  reveal(createRoomForm)
  
  // Generate a random room ID as a suggestion
  if (document.getElementById('createRoomId').value === '') {
    document.getElementById('createRoomId').value = generateRandomRoomId()
  }
}

function showJoinRoomForm() {
  hide(roomOptions)
  reveal(joinRoomForm)
}

function backToRoomOptions() {
  hide(createRoomForm)
  hide(joinRoomForm)
  reveal(roomOptions)
}

// Helper function to generate a random room ID
function generateRandomRoomId() {
  return Math.random().toString(36).substring(2, 8)
}

// Create and join a new room
function createAndJoinRoom() {
  const name = nameInput.value
  const roomTitle = document.getElementById('createRoomTitle').value
  let roomId = document.getElementById('createRoomId').value
  
  if (!roomTitle) {
    alert('Please enter a room title!')
    return
  }
  
  // Generate a random room ID if not provided
  if (!roomId) {
    roomId = generateRandomRoomId()
    document.getElementById('createRoomId').value = roomId
  }
  
  // Create the room and join it
  socket.request('createRoom', { room_id: roomId })
    .then(() => {
      joinRoom(name, roomId)
      // Update the URL to /title/roomid
      window.history.replaceState({}, '', `/${encodeURIComponent(roomTitle)}/${encodeURIComponent(roomId)}`)
      showNotification(`Room created successfully: ${roomId}`)
    })
    .catch((error) => {
      console.error('Error creating room:', error)
      alert('Error creating room. Please try again.')
    })
}

// Join an existing room
function joinExistingRoom() {
  const name = nameInput.value
  const roomId = document.getElementById('joinRoomId').value
  
  if (!roomId) {
    alert('Please enter a room ID!')
    return
  }
  
  // Check if the room exists first
  socket.request('checkRoom', { room_id: roomId })
    .then((response) => {
      if (response.exists) {
        joinRoom(name, roomId)
        // Update the URL (using room title from response if available)
        const roomTitle = response.title || 'meeting'
        window.history.replaceState({}, '', `/${encodeURIComponent(roomTitle)}/${encodeURIComponent(roomId)}`)
      } else {
        alert('Room does not exist. Please check the room ID or create a new room.')
      }
    })
    .catch(() => {
      // If checkRoom is not implemented in the backend, just try to join
      joinRoom(name, roomId)
      window.history.replaceState({}, '', `/${encodeURIComponent('meeting')}/${encodeURIComponent(roomId)}`)
    })
}

// Auto-join if URL is /title/roomid
window.addEventListener('DOMContentLoaded', () => {
  const match = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)$/)
  if (match) {
    const title = decodeURIComponent(match[1])
    const roomId = decodeURIComponent(match[2])
    
    // Set values in the join form
    if (document.getElementById('joinRoomId')) {
      document.getElementById('joinRoomId').value = roomId
    }
    
    // Remember room info for later
    window.directRoomAccess = {
      title: title,
      roomId: roomId
    }
    
    // Show a message to the user
    showNotification(`Direct access to room: ${roomId}. Complete your profile to join.`)
    
    // If user completes profile, auto-navigate to join room
    const originalContinueToRoomOptions = continueToRoomOptions;
    continueToRoomOptions = function() {
      // Call original function first
      if (originalContinueToRoomOptions()) {
        // If it succeeds, go directly to join room
        showJoinRoomForm();
        document.getElementById('joinRoomId').value = roomId;
        // Don't auto-join, let the user click the join button
      }
    }
  }
})
