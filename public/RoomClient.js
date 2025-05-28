const mediaType = {
  audio: 'audioType',
  video: 'videoType',
  screen: 'screenType'
}
const _EVENTS = {
  // Original events
  exitRoom: 'exitRoom',
  openRoom: 'openRoom',
  startVideo: 'startVideo',
  stopVideo: 'stopVideo',
  startAudio: 'startAudio',
  stopAudio: 'stopAudio',
  startScreen: 'startScreen',
  stopScreen: 'stopScreen',
  
  // Participant Events
  participantJoined: 'participantJoined',
  participantLeft: 'participantLeft',
  participantMuted: 'participantMuted',
  participantUnmuted: 'participantUnmuted',
  participantVideoEnabled: 'participantVideoEnabled',
  participantVideoDisabled: 'participantVideoDisabled',
  hostChanged: 'hostChanged',
  userKicked: 'userKicked',
  
  // Media Stream Events
  trackAdded: 'trackAdded',
  trackRemoved: 'trackRemoved',
  audioLevelChanged: 'audioLevelChanged',
  screenShareStarted: 'screenShareStarted',
  screenShareStopped: 'screenShareStopped',
  mediaStreamError: 'mediaStreamError',
  
  // Interaction Events
  reactionReceived: 'reactionReceived',
  raiseHand: 'raiseHand',
  
  // Network & Connection Events
  connectionStateChanged: 'connectionStateChanged',
  bandwidthEstimationChanged: 'bandwidthEstimationChanged',
  reconnectAttempt: 'reconnectAttempt',
  reconnectSuccess: 'reconnectSuccess',
  connectionFailed: 'connectionFailed',
  
  // Room/Session Lifecycle Events
  roomCreated: 'roomCreated',
  roomJoined: 'roomJoined',
  roomEnded: 'roomEnded',
  sessionTimeout: 'sessionTimeout',
  
  // Admin/Host Control Events
  muteAll: 'muteAll',
  lockRoom: 'lockRoom',
  unlockRoom: 'unlockRoom',
  
  // Error and Exception Events
  error: 'error',
  mediaError: 'mediaError',
  socketDisconnect: 'socketDisconnect',
  unauthorizedAccessAttempt: 'unauthorizedAccessAttempt'
}

class RoomClient {
  constructor(localMediaEl, remoteVideoEl, remoteAudioEl, mediasoupClient, socket, room_id, name, profilePicUrl, successCallback) {
    this.name = name
    this.profilePicUrl = profilePicUrl
    this.localMediaEl = localMediaEl
    this.remoteVideoEl = remoteVideoEl
    this.remoteAudioEl = remoteAudioEl
    this.mediasoupClient = mediasoupClient

    this.socket = socket
    this.producerTransport = null
    this.consumerTransport = null
    this.device = null
    this.room_id = room_id

    this.isVideoOnFullScreen = false
    this.isDevicesVisible = false

    this.consumers = new Map()
    this.producers = new Map()

    console.log('Mediasoup client', mediasoupClient)

    /**
     * map that contains a mediatype as key and producer_id as value
     */
    this.producerLabel = new Map()

    this._isOpen = false
    this.eventListeners = new Map()

    Object.keys(_EVENTS).forEach(
      function (evt) {
        this.eventListeners.set(evt, [])
      }.bind(this)
    )

    this.createRoom(room_id).then(
      async function () {
        await this.join(name, room_id, profilePicUrl)
        this.initSockets()
        this._isOpen = true
        this.showLocalProfileImage()
        successCallback()
      }.bind(this)
    )
  }

  ////////// INIT /////////

  async createRoom(room_id) {
    await this.socket
      .request('createRoom', {
        room_id
      })
      .catch((err) => {
        console.log('Create room error:', err)
      })
  }

  async join(name, room_id, profilePicUrl) {
    this.socket
      .request('join', {
        name,
        room_id,
        profilePicUrl
      })
      .then(
        async function (e) {
          // e.peers is the list of existing users
          if (e && e.peers) {
            e.peers.forEach((peer) => {
              this.addRemoteUserTile(peer)
            })
          }
          const data = await this.socket.request('getRouterRtpCapabilities')
          let device = await this.loadDevice(data)
          this.device = device
          await this.initTransports(device)
          this.socket.emit('getProducers')
        }.bind(this)
      )
      .catch((err) => {
        console.log('Join error:', err)
      })
  }

  async loadDevice(routerRtpCapabilities) {
    let device
    try {
      device = new this.mediasoupClient.Device()
    } catch (error) {
      if (error.name === 'UnsupportedError') {
        console.error('Browser not supported')
        alert('Browser not supported')
      }
      console.error(error)
    }
    await device.load({
      routerRtpCapabilities
    })
    return device
  }

  async initTransports(device) {
    // init producerTransport
    {
      const data = await this.socket.request('createWebRtcTransport', {
        forceTcp: false,
        rtpCapabilities: device.rtpCapabilities
      })

      if (data.error) {
        console.error(data.error)
        return
      }

      this.producerTransport = device.createSendTransport(data)

      this.producerTransport.on(
        'connect',
        async function ({ dtlsParameters }, callback, errback) {
          this.socket
            .request('connectTransport', {
              dtlsParameters,
              transport_id: data.id
            })
            .then(callback)
            .catch(errback)
        }.bind(this)
      )

      this.producerTransport.on(
        'produce',
        async function ({ kind, rtpParameters }, callback, errback) {
          try {
            const { producer_id } = await this.socket.request('produce', {
              producerTransportId: this.producerTransport.id,
              kind,
              rtpParameters
            })
            callback({
              id: producer_id
            })
          } catch (err) {
            errback(err)
          }
        }.bind(this)
      )

      this.producerTransport.on(
        'connectionstatechange',
        function (state) {
          switch (state) {
            case 'connecting':
              break

            case 'connected':
              //localVideo.srcObject = stream
              break

            case 'failed':
              this.producerTransport.close()
              break

            default:
              break
          }
        }.bind(this)
      )
    }

    // init consumerTransport
    {
      const data = await this.socket.request('createWebRtcTransport', {
        forceTcp: false
      })

      if (data.error) {
        console.error(data.error)
        return
      }

      // only one needed
      this.consumerTransport = device.createRecvTransport(data)
      this.consumerTransport.on(
        'connect',
        function ({ dtlsParameters }, callback, errback) {
          this.socket
            .request('connectTransport', {
              transport_id: this.consumerTransport.id,
              dtlsParameters
            })
            .then(callback)
            .catch(errback)
        }.bind(this)
      )

      this.consumerTransport.on(
        'connectionstatechange',
        async function (state) {
          switch (state) {
            case 'connecting':
              break

            case 'connected':
              //remoteVideo.srcObject = await stream;
              //await socket.request('resume');
              break

            case 'failed':
              this.consumerTransport.close()
              break

            default:
              break
          }
        }.bind(this)
      )
    }
  }

  initSockets() {
    // Original event handlers
    this.socket.on(
      'consumerClosed',
      function ({ consumer_id }) {
        console.log('Closing consumer:', consumer_id)
        this.removeConsumer(consumer_id)
      }.bind(this)
    )

    /**
     * data: [ {
     *  producer_id:
     *  producer_socket_id:
     * }]
     */
    this.socket.on(
      'newProducers',
      async function (data) {
        console.log('New producers', data)
        for (let { producer_id } of data) {
          await this.consume(producer_id)
        }
      }.bind(this)
    )

    this.socket.on(
      'disconnect',
      function () {
        this.exit(true)
        this.event(_EVENTS.socketDisconnect)
      }.bind(this)
    )

    // User join/leave events
    this.socket.on(
      'user-joined',
      function (user) {
        this.addRemoteUserTile(user)
        this.event(_EVENTS.participantJoined, user)
      }.bind(this)
    )

    this.socket.on(
      'user-left',
      function (user) {
        // user.peerId should be present
        if (user && user.peerId) {
          this.removeRemoteUserTile(user.peerId)
          this.event(_EVENTS.participantLeft, user)
        }
      }.bind(this)
    )
    
    // Participant Events
    this.socket.on(
      'participant-muted',
      function (participantId) {
        console.log('Participant muted:', participantId)
        this.event(_EVENTS.participantMuted, participantId)
      }.bind(this)
    )
    
    this.socket.on(
      'participant-unmuted',
      function (participantId) {
        console.log('Participant unmuted:', participantId)
        this.event(_EVENTS.participantUnmuted, participantId)
      }.bind(this)
    )
    
    this.socket.on(
      'participant-video-enabled',
      function (participantId) {
        console.log('Participant video enabled:', participantId)
        this.event(_EVENTS.participantVideoEnabled, participantId)
      }.bind(this)
    )
    
    this.socket.on(
      'participant-video-disabled',
      function (participantId) {
        console.log('Participant video disabled:', participantId)
        this.event(_EVENTS.participantVideoDisabled, participantId)
      }.bind(this)
    )
    
    this.socket.on(
      'host-changed',
      function (newHostId) {
        console.log('Host changed to:', newHostId)
        this.event(_EVENTS.hostChanged, newHostId)
      }.bind(this)
    )
    
    this.socket.on(
      'user-kicked',
      function (participantId) {
        console.log('User kicked:', participantId)
        // If this user is being kicked, exit the room
        if (participantId === this.socket.id) {
          this.exit(true)
        }
        this.event(_EVENTS.userKicked, participantId)
      }.bind(this)
    )
    
    // Media Stream Events
    this.socket.on(
      'track-added',
      function ({ participantId, mediaTrack }) {
        console.log('Track added:', participantId, mediaTrack)
        this.event(_EVENTS.trackAdded, { participantId, mediaTrack })
      }.bind(this)
    )
    
    this.socket.on(
      'track-removed',
      function ({ participantId, mediaTrack }) {
        console.log('Track removed:', participantId, mediaTrack)
        this.event(_EVENTS.trackRemoved, { participantId, mediaTrack })
      }.bind(this)
    )
    
    this.socket.on(
      'audio-level-changed',
      function ({ participantId, level }) {
        // Don't log this as it's high frequency
        this.event(_EVENTS.audioLevelChanged, { participantId, level })
      }.bind(this)
    )
    
    this.socket.on(
      'screen-share-started',
      function (participantId) {
        console.log('Screen share started:', participantId)
        this.event(_EVENTS.screenShareStarted, participantId)
      }.bind(this)
    )
    
    this.socket.on(
      'screen-share-stopped',
      function (participantId) {
        console.log('Screen share stopped:', participantId)
        this.event(_EVENTS.screenShareStopped, participantId)
      }.bind(this)
    )
    
    this.socket.on(
      'media-stream-error',
      function (error) {
        console.error('Media stream error:', error)
        this.event(_EVENTS.mediaStreamError, error)
      }.bind(this)
    )
    
    // Interaction Events
    this.socket.on(
      'reaction-received',
      function ({ senderId, reactionType }) {
        console.log('Reaction received:', senderId, reactionType)
        this.event(_EVENTS.reactionReceived, { senderId, reactionType })
      }.bind(this)
    )
    
    this.socket.on(
      'raise-hand',
      function (participantId) {
        console.log('Hand raised by:', participantId)
        this.event(_EVENTS.raiseHand, participantId)
      }.bind(this)
    )
    
    // Network & Connection Events
    this.socket.on(
      'connection-state-changed',
      function ({ participantId, state }) {
        console.log('Connection state changed:', participantId, state)
        this.event(_EVENTS.connectionStateChanged, { participantId, state })
      }.bind(this)
    )
    
    this.socket.on(
      'bandwidth-estimation-changed',
      function (estimate) {
        console.log('Bandwidth estimation changed:', estimate)
        this.event(_EVENTS.bandwidthEstimationChanged, estimate)
      }.bind(this)
    )
    
    this.socket.on(
      'reconnect-attempt',
      function (participantId) {
        console.log('Reconnect attempt:', participantId)
        this.event(_EVENTS.reconnectAttempt, participantId)
      }.bind(this)
    )
    
    this.socket.on(
      'reconnect-success',
      function (participantId) {
        console.log('Reconnect success:', participantId)
        this.event(_EVENTS.reconnectSuccess, participantId)
      }.bind(this)
    )
    
    this.socket.on(
      'connection-failed',
      function (error) {
        console.error('Connection failed:', error)
        this.event(_EVENTS.connectionFailed, error)
      }.bind(this)
    )
    
    // Room/Session Lifecycle Events
    this.socket.on(
      'room-created',
      function (roomId) {
        console.log('Room created:', roomId)
        this.event(_EVENTS.roomCreated, roomId)
      }.bind(this)
    )
    
    this.socket.on(
      'room-joined',
      function (roomData) {
        console.log('Room joined:', roomData)
        this.event(_EVENTS.roomJoined, roomData)
      }.bind(this)
    )
    
    this.socket.on(
      'room-ended',
      function (roomId) {
        console.log('Room ended:', roomId)
        this.exit(true)
        this.event(_EVENTS.roomEnded, roomId)
      }.bind(this)
    )
    
    this.socket.on(
      'session-timeout',
      function () {
        console.log('Session timeout')
        this.exit(true)
        this.event(_EVENTS.sessionTimeout)
      }.bind(this)
    )
    
    // Admin/Host Control Events
    this.socket.on(
      'mute-all',
      function () {
        console.log('Mute all request received')
        // Close audio producer if exists
        if (this.producerLabel.has(mediaType.audio)) {
          this.closeProducer(mediaType.audio)
        }
        this.event(_EVENTS.muteAll)
      }.bind(this)
    )
    
    this.socket.on(
      'lock-room',
      function () {
        console.log('Room locked')
        this.event(_EVENTS.lockRoom)
      }.bind(this)
    )
    
    this.socket.on(
      'unlock-room',
      function () {
        console.log('Room unlocked')
        this.event(_EVENTS.unlockRoom)
      }.bind(this)
    )
    
    // Error and Exception Events
    this.socket.on(
      'error',
      function ({ errorCode, errorMessage }) {
        console.error('Error:', errorCode, errorMessage)
        this.event(_EVENTS.error, { errorCode, errorMessage })
      }.bind(this)
    )
    
    this.socket.on(
      'media-error',
      function ({ participantId, mediaType, error }) {
        console.error('Media error:', participantId, mediaType, error)
        this.event(_EVENTS.mediaError, { participantId, mediaType, error })
      }.bind(this)
    )
    
    this.socket.on(
      'unauthorized-access-attempt',
      function () {
        console.error('Unauthorized access attempt')
        this.event(_EVENTS.unauthorizedAccessAttempt)
      }.bind(this)
    )
  }

  //////// MAIN FUNCTIONS /////////////

  async produce(type, deviceId = null) {
    let mediaConstraints = {}
    let audio = false
    let screen = false
    switch (type) {
      case mediaType.audio:
        mediaConstraints = {
          audio: {
            deviceId: deviceId
          },
          video: false
        }
        audio = true
        break
      case mediaType.video:
        mediaConstraints = {
          audio: false,
          video: {
            width: {
              min: 640,
              ideal: 1920
            },
            height: {
              min: 400,
              ideal: 1080
            },
            deviceId: deviceId
            /*aspectRatio: {
                            ideal: 1.7777777778
                        }*/
          }
        }
        break
      case mediaType.screen:
        mediaConstraints = false
        screen = true
        break
      default:
        return
    }
    if (!this.device.canProduce('video') && !audio) {
      console.error('Cannot produce video')
      return
    }
    if (this.producerLabel.has(type)) {
      console.log('Producer already exists for this type ' + type)
      return
    }
    console.log('Mediacontraints:', mediaConstraints)
    let stream
    try {
      stream = screen
        ? await navigator.mediaDevices.getDisplayMedia()
        : await navigator.mediaDevices.getUserMedia(mediaConstraints)
      console.log(navigator.mediaDevices.getSupportedConstraints())

      const track = audio ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0]
      const params = {
        track
      }
      if (!audio && !screen) {
        params.encodings = [
          {
            rid: 'r0',
            maxBitrate: 100000,
            //scaleResolutionDownBy: 10.0,
            scalabilityMode: 'S1T3'
          },
          {
            rid: 'r1',
            maxBitrate: 300000,
            scalabilityMode: 'S1T3'
          },
          {
            rid: 'r2',
            maxBitrate: 900000,
            scalabilityMode: 'S1T3'
          }
        ]
        params.codecOptions = {
          videoGoogleStartBitrate: 1000
        }
      }
      producer = await this.producerTransport.produce(params)

      console.log('Producer', producer)

      this.producers.set(producer.id, producer)

      let elem
      if (!audio) {
        elem = document.createElement('video')
        elem.srcObject = stream
        elem.id = producer.id
        elem.playsinline = false
        elem.autoplay = true
        elem.className = 'vid'

        // Create a container for video and username
        const containerDiv = document.createElement('div')
        containerDiv.style.display = 'flex'
        containerDiv.style.flexDirection = 'column'
        containerDiv.style.alignItems = 'center'
        containerDiv.style.margin = '10px'
        
        containerDiv.appendChild(elem)

        // Create and add username display below local video
        const usernameDiv = document.createElement('div')
        usernameDiv.textContent = this.name
        usernameDiv.className = 'username-display'
        containerDiv.appendChild(usernameDiv)

        this.localMediaEl.appendChild(containerDiv)
        this.handleFS(elem.id)

        // Remove profile image if present (when video starts)
        this.showLocalProfileImageRemoveOnly()
      }

      producer.on('trackended', () => {
        this.closeProducer(type)
      })

      producer.on('transportclose', () => {
        console.log('Producer transport close')
        if (!audio) {
          elem.srcObject.getTracks().forEach(function (track) {
            track.stop()
          })
          elem.parentNode.removeChild(elem)
        }
        this.producers.delete(producer.id)
      })

      producer.on('close', () => {
        console.log('Closing producer')
        if (!audio) {
          elem.srcObject.getTracks().forEach(function (track) {
            track.stop()
          })
          elem.parentNode.removeChild(elem)
        }
        this.producers.delete(producer.id)
      })

      this.producerLabel.set(type, producer.id)

      switch (type) {
        case mediaType.audio:
          this.event(_EVENTS.startAudio)
          break
        case mediaType.video:
          this.event(_EVENTS.startVideo)
          break
        case mediaType.screen:
          this.event(_EVENTS.startScreen)
          break
        default:
          return
      }
    } catch (err) {
      console.log('Produce error:', err)
    }
  }

  async consume(producer_id) {
    this.getConsumeStream(producer_id).then(
      function ({ consumer, stream, kind, producerName }) {
        // Check if we already have a consumer with this ID to avoid duplicates
        if (this.consumers.has(consumer.id)) {
          console.log(`Consumer ${consumer.id} already exists, not creating duplicate`)
          return
        }
        
        this.consumers.set(consumer.id, consumer)

        let elem
        if (kind === 'video') {
          // Check if video element already exists
          if (document.getElementById(consumer.id)) {
            console.log(`Video element for ${consumer.id} already exists, not creating duplicate`)
            return
          }
          
          elem = document.createElement('video')
          elem.srcObject = stream
          elem.id = consumer.id
          elem.playsinline = false
          elem.autoplay = true
          elem.className = 'vid'
          
          // Create a container for video and username with a unique ID
          const containerDiv = document.createElement('div')
          containerDiv.id = `container-${consumer.id}`
          containerDiv.style.display = 'flex'
          containerDiv.style.flexDirection = 'column'
          containerDiv.style.alignItems = 'center'
          containerDiv.style.margin = '10px'
          
          containerDiv.appendChild(elem)
          
          // Create and add username display below remote video
          const remoteUsernameDiv = document.createElement('div')
          remoteUsernameDiv.textContent = producerName || 'Unknown User'
          remoteUsernameDiv.className = 'username-display'
          containerDiv.appendChild(remoteUsernameDiv)
          
          this.remoteVideoEl.appendChild(containerDiv)
          this.handleFS(elem.id)
        } else {
          // Check if audio element already exists
          if (document.getElementById(consumer.id)) {
            console.log(`Audio element for ${consumer.id} already exists, not creating duplicate`)
            return
          }
          
          elem = document.createElement('audio')
          elem.srcObject = stream
          elem.id = consumer.id
          elem.playsinline = false
          elem.autoplay = true
          this.remoteAudioEl.appendChild(elem)
        }

        consumer.on(
          'trackended',
          function () {
            this.removeConsumer(consumer.id)
          }.bind(this)
        )

        consumer.on(
          'transportclose',
          function () {
            this.removeConsumer(consumer.id)
          }.bind(this)
        )
      }.bind(this)
    )
  }

  async getConsumeStream(producerId) {
    const { rtpCapabilities } = this.device
    const data = await this.socket.request('consume', {
      rtpCapabilities,
      consumerTransportId: this.consumerTransport.id,
      producerId
    })
    const { id, kind, rtpParameters, producerName } = data  // Get producer name from server

    let codecOptions = {}
    const consumer = await this.consumerTransport.consume({
      id,
      producerId,
      kind,
      rtpParameters,
      codecOptions
    })

    const stream = new MediaStream()
    stream.addTrack(consumer.track)

    return {
      consumer,
      stream,
      kind,
      producerName // Pass producerName to consume
    }
  }

  closeProducer(type) {
    if (!this.producerLabel.has(type)) {
      console.log('There is no producer for this type ' + type)
      return
    }

    let producer_id = this.producerLabel.get(type)
    console.log('Close producer', producer_id)

    this.socket.emit('producerClosed', {
      producer_id
    })

    this.producers.get(producer_id).close()
    this.producers.delete(producer_id)
    this.producerLabel.delete(type)

    if (type !== mediaType.audio) {
      let elem = document.getElementById(producer_id)
      if (elem) {
      elem.srcObject.getTracks().forEach(function (track) {
        track.stop()
      })
      elem.parentNode.removeChild(elem)
      }
      // Show profile image if video is stopped
      if (type === mediaType.video) {
        this.showLocalProfileImage()
      }
    }

    switch (type) {
      case mediaType.audio:
        this.event(_EVENTS.stopAudio)
        break
      case mediaType.video:
        this.event(_EVENTS.stopVideo)
        break
      case mediaType.screen:
        this.event(_EVENTS.stopScreen)
        break
      default:
        return
    }
  }

  pauseProducer(type) {
    if (!this.producerLabel.has(type)) {
      console.log('There is no producer for this type ' + type)
      return
    }

    let producer_id = this.producerLabel.get(type)
    this.producers.get(producer_id).pause()
  }

  resumeProducer(type) {
    if (!this.producerLabel.has(type)) {
      console.log('There is no producer for this type ' + type)
      return
    }

    let producer_id = this.producerLabel.get(type)
    this.producers.get(producer_id).resume()
  }

  removeConsumer(consumer_id) {
    // Find the media element
    let elem = document.getElementById(consumer_id)
    if (elem) {
      // Stop all tracks
      if (elem.srcObject && elem.srcObject.getTracks) {
        elem.srcObject.getTracks().forEach(function (track) {
          track.stop()
        })
      }
      
      // Find the container by its unique ID
      let container = document.getElementById(`container-${consumer_id}`)
      if (container) {
        // Remove the container directly
        container.parentNode.removeChild(container)
      } else {
        // Fallback to finding the container as parent
        container = elem.parentNode
        if (container && container.parentNode) {
          container.parentNode.removeChild(container)
        }
      }
    }
    
    // Always make sure to delete from the consumer map
    this.consumers.delete(consumer_id)
    
    console.log(`Consumer ${consumer_id} removed successfully`)
  }

  exit(offline = false) {
    let clean = function () {
      this._isOpen = false
      this.consumerTransport.close()
      this.producerTransport.close()
      this.socket.off('disconnect')
      this.socket.off('newProducers')
      this.socket.off('consumerClosed')
    }.bind(this)

    if (!offline) {
      this.socket
        .request('exitRoom')
        .then((e) => console.log(e))
        .catch((e) => console.warn(e))
        .finally(
          function () {
            clean()
          }.bind(this)
        )
    } else {
      clean()
    }

    this.event(_EVENTS.exitRoom)
  }

  ///////  HELPERS //////////

  async roomInfo() {
    let info = await this.socket.request('getMyRoomInfo')
    return info
  }

  static get mediaType() {
    return mediaType
  }

  event(evt, data) {
    if (this.eventListeners.has(evt)) {
      this.eventListeners.get(evt).forEach((callback) => callback(data))
    }
  }

  on(evt, callback) {
    this.eventListeners.get(evt).push(callback)
  }

  //////// GETTERS ////////

  isOpen() {
    return this._isOpen
  }

  static get EVENTS() {
    return _EVENTS
  }

  //////// UTILITY ////////

  copyURL() {
    let tmpInput = document.createElement('input')
    document.body.appendChild(tmpInput)
    tmpInput.value = window.location.href
    tmpInput.select()
    document.execCommand('copy')
    document.body.removeChild(tmpInput)
    console.log('URL copied to clipboard 👍')
  }

  showDevices() {
    if (!this.isDevicesVisible) {
      reveal(devicesList)
      this.isDevicesVisible = true
    } else {
      hide(devicesList)
      this.isDevicesVisible = false
    }
  }

  handleFS(id) {
    let videoPlayer = document.getElementById(id)
    videoPlayer.addEventListener('fullscreenchange', (e) => {
      if (videoPlayer.controls) return
      let fullscreenElement = document.fullscreenElement
      if (!fullscreenElement) {
        videoPlayer.style.pointerEvents = 'auto'
        this.isVideoOnFullScreen = false
      }
    })
    videoPlayer.addEventListener('webkitfullscreenchange', (e) => {
      if (videoPlayer.controls) return
      let webkitIsFullScreen = document.webkitIsFullScreen
      if (!webkitIsFullScreen) {
        videoPlayer.style.pointerEvents = 'auto'
        this.isVideoOnFullScreen = false
      }
    })
    videoPlayer.addEventListener('click', (e) => {
      if (videoPlayer.controls) return
      if (!this.isVideoOnFullScreen) {
        if (videoPlayer.requestFullscreen) {
          videoPlayer.requestFullscreen()
        } else if (videoPlayer.webkitRequestFullscreen) {
          videoPlayer.webkitRequestFullscreen()
        } else if (videoPlayer.msRequestFullscreen) {
          videoPlayer.msRequestFullscreen()
        }
        this.isVideoOnFullScreen = true
        videoPlayer.style.pointerEvents = 'none'
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen()
        } else if (document.webkitCancelFullScreen) {
          document.webkitCancelFullScreen()
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen()
        }
        this.isVideoOnFullScreen = false
        videoPlayer.style.pointerEvents = 'auto'
      }
    })
  }

  showLocalProfileImage() {
    // Remove any existing profile image
    const existingProfileImg = this.localMediaEl.querySelector('.local-profile-img')
    if (existingProfileImg) existingProfileImg.parentNode.removeChild(existingProfileImg)
    // Remove any existing video containers
    const videoContainers = this.localMediaEl.querySelectorAll('div')
    videoContainers.forEach(div => {
      if (div.querySelector('video')) div.parentNode.removeChild(div)
    })
    // Remove any existing username display
    const existingUsername = this.localMediaEl.querySelector('.username-display')
    if (existingUsername) existingUsername.parentNode.removeChild(existingUsername)
    // Add profile image if available
    if (this.profilePicUrl) {
      const img = document.createElement('img')
      img.src = this.profilePicUrl
      img.className = 'local-profile-img'
      img.style.maxWidth = '200px'
      img.style.maxHeight = '200px'
      img.style.borderRadius = '50%'
      img.style.border = '2px solid #2c3e50'
      img.style.margin = '10px auto 0 auto'
      img.style.display = 'block'
      this.localMediaEl.appendChild(img)
      // Add username below profile image
      const usernameDiv = document.createElement('div')
      usernameDiv.textContent = this.name
      usernameDiv.className = 'username-display'
      usernameDiv.style.textAlign = 'center'
      usernameDiv.style.marginBottom = '15px'
      this.localMediaEl.appendChild(usernameDiv)
    }
  }

  showLocalProfileImageRemoveOnly() {
    // Remove only the profile image, not video containers
    const existingProfileImg = this.localMediaEl.querySelector('.local-profile-img')
    if (existingProfileImg) existingProfileImg.parentNode.removeChild(existingProfileImg)
    // Remove any existing username display
    const existingUsername = this.localMediaEl.querySelector('.username-display')
    if (existingUsername) existingUsername.parentNode.removeChild(existingUsername)
  }

  addRemoteUserTile(user) {
    // Only add if not already present
    if (document.getElementById('user-tile-' + user.peerId)) return
    const containerDiv = document.createElement('div')
    containerDiv.id = 'user-tile-' + user.peerId
    containerDiv.style.display = 'flex'
    containerDiv.style.flexDirection = 'column'
    containerDiv.style.alignItems = 'center'
    containerDiv.style.margin = '10px'
    // Profile picture
    const img = document.createElement('img')
    img.src = user.profilePicUrl
    img.alt = user.name
    img.className = 'profile-pic'
    img.style.width = '40px'
    img.style.height = '40px'
    img.style.borderRadius = '50%'
    img.style.marginBottom = '4px'
    containerDiv.appendChild(img)
    // Name
    const nameDiv = document.createElement('div')
    nameDiv.textContent = user.name
    nameDiv.className = 'username-display'
    containerDiv.appendChild(nameDiv)
    // Add to remote video area
    this.remoteVideoEl.appendChild(containerDiv)
  }

  removeRemoteUserTile(peerId) {
    const tile = document.getElementById('user-tile-' + peerId)
    if (tile && tile.parentNode) {
      tile.parentNode.removeChild(tile)
    }
  }
}
