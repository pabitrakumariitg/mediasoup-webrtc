const config = require('./config')
module.exports = class Room {
  constructor(room_id, worker, io) {
    this.id = room_id
    const mediaCodecs = config.mediasoup.router.mediaCodecs
    worker
      .createRouter({
        mediaCodecs
      })
      .then(
        function (router) {
          this.router = router
        }.bind(this)
      )

    this.peers = new Map()
    this.io = io
  }

  addPeer(peer) {
    this.peers.set(peer.id, peer)
  }

  getProducerListForPeer() {
    let producerList = []
    this.peers.forEach((peer) => {
      peer.producers.forEach((producer) => {
        producerList.push({
          producer_id: producer.id
        })
      })
    })
    return producerList
  }

  getRtpCapabilities() {
    return this.router.rtpCapabilities
  }

  async createWebRtcTransport(socket_id) {
    const { maxIncomingBitrate, initialAvailableOutgoingBitrate } = config.mediasoup.webRtcTransport

    const transport = await this.router.createWebRtcTransport({
      listenIps: config.mediasoup.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate
    })
    if (maxIncomingBitrate) {
      try {
        await transport.setMaxIncomingBitrate(maxIncomingBitrate)
      } catch (error) {}
    }

    transport.on(
      'dtlsstatechange',
      function (dtlsState) {
        if (dtlsState === 'closed') {
          console.log('Transport close', { name: this.peers.get(socket_id).name })
          transport.close()
        }
      }.bind(this)
    )

    transport.on('close', () => {
      console.log('Transport close', { name: this.peers.get(socket_id).name })
    })

    console.log('Adding transport', { transportId: transport.id })
    this.peers.get(socket_id).addTransport(transport)
    return {
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      }
    }
  }

  async connectPeerTransport(socket_id, transport_id, dtlsParameters) {
    if (!this.peers.has(socket_id)) return

    await this.peers.get(socket_id).connectTransport(transport_id, dtlsParameters)
  }

  async produce(socket_id, producerTransportId, rtpParameters, kind) {
    // handle undefined errors
    return new Promise(
      async function (resolve, reject) {
        let producer = await this.peers.get(socket_id).createProducer(producerTransportId, rtpParameters, kind)
        resolve(producer.id)
        this.broadCast(socket_id, 'newProducers', [
          {
            producer_id: producer.id,
            producer_socket_id: socket_id
          }
        ])
      }.bind(this)
    )
  }

  async consume(socket_id, consumer_transport_id, producer_id, rtpCapabilities) {
    // handle nulls
    if (
      !this.router.canConsume({
        producerId: producer_id,
        rtpCapabilities
      })
    ) {
      console.error('can not consume')
      return
    }

    let { consumer, params } = await this.peers
      .get(socket_id)
      .createConsumer(consumer_transport_id, producer_id, rtpCapabilities)

    // Find the peer that owns this producer
    console.log('DEBUG: Listing all peers and their producers:')
    for (let peer of this.peers.values()) {
      console.log(`Peer: ${peer.name}, Producers: [${Array.from(peer.producers.keys()).join(', ')}]`)
    }
    let producerPeer = null
    for (let peer of this.peers.values()) {
      if (peer.producers.has(producer_id)) {
        producerPeer = peer
        break
      }
    }

    // Add producer's name to params
    params.producerName = producerPeer ? producerPeer.name : 'Unknown User'

    consumer.on(
      'producerclose',
      function () {
        console.log('Consumer closed due to producerclose event', {
          name: `${this.peers.get(socket_id).name}`,
          consumer_id: `${consumer.id}`
        })
        this.peers.get(socket_id).removeConsumer(consumer.id)
        // tell client consumer is dead
        this.io.to(socket_id).emit('consumerClosed', {
          consumer_id: consumer.id
        })
      }.bind(this)
    )

    return params
  }

  async removePeer(socket_id) {
    // Save user info before deletion
    const peer = this.peers.get(socket_id)
    if (peer) {
      // Notify others before removing
      this.broadCast(socket_id, 'user-left', {
        peerId: socket_id,
        name: peer.name
      })
      peer.close()
      this.peers.delete(socket_id)
    }
  }

  closeProducer(socket_id, producer_id) {
    this.peers.get(socket_id).closeProducer(producer_id)
  }

  broadCast(socket_id, name, data) {
    for (let otherID of Array.from(this.peers.keys()).filter((id) => id !== socket_id)) {
      this.send(otherID, name, data)
    }
  }

  send(socket_id, name, data) {
    this.io.to(socket_id).emit(name, data)
  }

  getPeers() {
    return this.peers
  }

  toJson() {
    return {
      id: this.id,
      peers: JSON.stringify([...this.peers])
    }
  }

  // Participant Events
  emitParticipantJoined(participant) {
    // When a new participant joins, broadcast to all peers
    this.broadCast(participant.id, 'user-joined', participant)
  }

  emitParticipantLeft(participant) {
    // When a participant leaves, broadcast to all peers
    this.broadCast(participant.id, 'user-left', participant)
  }

  emitParticipantMuted(participantId) {
    // When a participant is muted, broadcast to all peers
    this.io.to(this.id).emit('participant-muted', participantId)
  }

  emitParticipantUnmuted(participantId) {
    // When a participant is unmuted, broadcast to all peers
    this.io.to(this.id).emit('participant-unmuted', participantId)
  }

  emitParticipantVideoEnabled(participantId) {
    // When a participant enables video, broadcast to all peers
    this.io.to(this.id).emit('participant-video-enabled', participantId)
  }

  emitParticipantVideoDisabled(participantId) {
    // When a participant disables video, broadcast to all peers
    this.io.to(this.id).emit('participant-video-disabled', participantId)
  }

  emitHostChanged(newHostId) {
    // When host changes, broadcast to all peers
    this.io.to(this.id).emit('host-changed', newHostId)
  }

  emitUserKicked(participantId) {
    // When a user is kicked, notify all peers and the kicked user
    this.io.to(this.id).emit('user-kicked', participantId)
    // Also notify the kicked user directly
    this.send(participantId, 'user-kicked', participantId)
  }

  // Media Stream Events
  emitTrackAdded(participantId, mediaTrack) {
    // When a track is added, broadcast to all peers
    this.io.to(this.id).emit('track-added', { participantId, mediaTrack })
  }

  emitTrackRemoved(participantId, mediaTrack) {
    // When a track is removed, broadcast to all peers
    this.io.to(this.id).emit('track-removed', { participantId, mediaTrack })
  }

  emitAudioLevelChanged(participantId, level) {
    // When audio level changes, broadcast to all peers
    this.io.to(this.id).emit('audio-level-changed', { participantId, level })
  }

  emitScreenShareStarted(participantId) {
    // When screen sharing starts, broadcast to all peers
    this.io.to(this.id).emit('screen-share-started', participantId)
  }

  emitScreenShareStopped(participantId) {
    // When screen sharing stops, broadcast to all peers
    this.io.to(this.id).emit('screen-share-stopped', participantId)
  }

  emitMediaStreamError(error) {
    // When there's a media stream error, broadcast to all peers
    this.io.to(this.id).emit('media-stream-error', error)
  }

  // Interaction Events
  emitReactionReceived(senderId, reactionType) {
    // When a reaction is received, broadcast to all peers
    this.io.to(this.id).emit('reaction-received', { senderId, reactionType })
  }

  emitRaiseHand(participantId) {
    // When a participant raises hand, broadcast to all peers
    this.io.to(this.id).emit('raise-hand', participantId)
  }

  // Network & Connection Events
  emitConnectionStateChanged(participantId, state) {
    // When connection state changes, broadcast to all peers
    this.io.to(this.id).emit('connection-state-changed', { participantId, state })
  }

  emitBandwidthEstimationChanged(estimate) {
    // When bandwidth estimation changes, broadcast to all peers
    this.io.to(this.id).emit('bandwidth-estimation-changed', estimate)
  }

  emitReconnectAttempt(participantId) {
    // When reconnection is attempted, broadcast to all peers
    this.io.to(this.id).emit('reconnect-attempt', participantId)
  }

  emitReconnectSuccess(participantId) {
    // When reconnection succeeds, broadcast to all peers
    this.io.to(this.id).emit('reconnect-success', participantId)
  }

  emitConnectionFailed(error) {
    // When connection fails, broadcast to all peers
    this.io.to(this.id).emit('connection-failed', error)
  }

  // Room/Session Lifecycle Events
  emitRoomCreated(roomId) {
    // When room is created, broadcast to all peers
    this.io.to(this.id).emit('room-created', roomId)
  }

  emitRoomJoined(roomData) {
    // When room is joined, broadcast to all peers
    this.io.to(this.id).emit('room-joined', roomData)
  }

  emitRoomEnded(roomId) {
    // When room ends, broadcast to all peers
    this.io.to(this.id).emit('room-ended', roomId)
  }

  emitSessionTimeout() {
    // When session times out, broadcast to all peers
    this.io.to(this.id).emit('session-timeout')
  }

  // Admin/Host Control Events
  emitMuteAll() {
    // When all participants should be muted, broadcast to all peers
    this.io.to(this.id).emit('mute-all')
  }

  emitLockRoom() {
    // When room is locked, broadcast to all peers
    this.io.to(this.id).emit('lock-room')
  }

  emitUnlockRoom() {
    // When room is unlocked, broadcast to all peers
    this.io.to(this.id).emit('unlock-room')
  }

  // Error and Exception Events
  emitError(errorCode, errorMessage) {
    // When an error occurs, broadcast to all peers
    this.io.to(this.id).emit('error', { errorCode, errorMessage })
  }

  emitMediaError(participantId, mediaType, error) {
    // When a media error occurs, broadcast to all peers
    this.io.to(this.id).emit('media-error', { participantId, mediaType, error })
  }

  emitSocketDisconnect(reason) {
    // When socket disconnects, broadcast to all peers
    this.io.to(this.id).emit('socket-disconnect', reason)
  }

  emitUnauthorizedAccessAttempt() {
    // When unauthorized access is attempted, broadcast to all peers
    this.io.to(this.id).emit('unauthorized-access-attempt')
  }
}
