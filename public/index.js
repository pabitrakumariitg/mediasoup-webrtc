if (location.href.substr(0, 5) !== 'https') location.href = 'https' + location.href.substr(4, location.href.length - 4)

const socket = io()

let producer = null

nameInput.value = 'user_' + Math.round(Math.random() * 1000)

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
    initEnumerateDevices()

    rc = new RoomClient(localMedia, remoteVideos, remoteAudios, window.mediasoupClient, socket, room_id, name, window.profileImageDataUrl, roomOpen)

    addListeners()
  }
}

function roomOpen() {
  login.className = 'hidden'
  reveal(startAudioButton)
  hide(stopAudioButton)
  reveal(startVideoButton)
  hide(stopVideoButton)
  reveal(startScreenButton)
  hide(stopScreenButton)
  reveal(exitButton)
  reveal(copyButton)
  reveal(devicesButton)
  control.className = ''
  reveal(videoMedia)
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
    hide(control)
    hide(devicesList)
    hide(videoMedia)
    hide(copyButton)
    hide(devicesButton)
    reveal(login)
  })
}

let isEnumerateDevices = false

function initEnumerateDevices() {
  // Many browsers, without the consent of getUserMedia, cannot enumerate the devices.
  if (isEnumerateDevices) return

  const constraints = {
    audio: true,
    video: true
  }

  navigator.mediaDevices
    .getUserMedia(constraints)
    .then((stream) => {
      enumerateDevices()
      stream.getTracks().forEach(function (track) {
        track.stop()
      })
    })
    .catch((err) => {
      console.error('Access denied for audio/video: ', err)
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

function joinRoomWithTitle() {
  const name = nameInput.value
  const room_id = roomidInput.value
  const title = titleInput.value
  if (!room_id || !title || !name) {
    alert('Please enter room id, title, and username!')
    return
  }
  if (!window.profileImageDataUrl) {
    alert('Please upload a profile image before joining the room!')
    return
  }
  // Always try to create the room first
  socket.request('createRoom', { room_id })
    .catch(() => {}) // Ignore error if already exists
    .finally(() => {
      joinRoom(name, room_id)
      // Update the URL to /title/roomid
      window.history.replaceState({}, '', `/${encodeURIComponent(title)}/${encodeURIComponent(room_id)}`)
    })
}

// Auto-join if URL is /title/roomid
window.addEventListener('DOMContentLoaded', () => {
  const match = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)$/)
  if (match) {
    const title = decodeURIComponent(match[1])
    const room_id = decodeURIComponent(match[2])
    titleInput.value = title
    roomidInput.value = room_id
    // Optionally, auto-generate a username if not set
    if (!nameInput.value || nameInput.value === 'user') {
      nameInput.value = 'user_' + Math.round(Math.random() * 1000)
    }
    // Wait for device enumeration before joining
    enumerateDevices().then(() => {
      joinRoomWithTitle()
    })
  }
})
