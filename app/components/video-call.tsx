import { useEffect, useRef, useState } from "react"
import { v4 as uuidv4 } from "uuid"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"

interface VideoCallProps {
  roomId: string
  username: string
}

interface Peer {
  id: string
  username: string
  stream?: MediaStream
  connection?: RTCPeerConnection
}

interface ChatMessage {
  from: string
  username: string
  message: string
  timestamp: Date
}

export default function VideoCall({ roomId, username }: VideoCallProps) {
  const [peers, setPeers] = useState<Record<string, Peer>>({})
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [messageInput, setMessageInput] = useState("")

  const clientId = useRef(uuidv4()).current
  const socketRef = useRef<WebSocket | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const screenStream = useRef<MediaStream | null>(null)
  const originalStream = useRef<MediaStream | null>(null)

  // Setup WebRTC and WebSocket connection
  useEffect(() => {
    if (!roomId || !username) return

    const initializeMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        })

        setLocalStream(stream)
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
        }
        originalStream.current = stream

        // Initialize WebSocket connection after media is ready
        initializeWebSocket()
      } catch (error) {
        console.error("Error accessing media devices:", error)
        alert("Could not access camera or microphone. Please check permissions.")
      }
    }

    initializeMedia()

    return () => {
      // Cleanup
      if (socketRef.current) {
        socketRef.current.close()
      }

      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop())
      }

      // Close all peer connections
      Object.values(peers).forEach((peer) => {
        if (peer.connection) {
          peer.connection.close()
        }
      })
    }
  }, [roomId, username])

  const initializeWebSocket = () => {
    const wsUrl = `ws://localhost:8080/ws?roomId=${roomId}&clientId=${clientId}&username=${encodeURIComponent(username)}`
    socketRef.current = new WebSocket(wsUrl)

    socketRef.current.onopen = () => {
      console.log("WebSocket connection established")
    }

    socketRef.current.onmessage = (event) => {
      const message = JSON.parse(event.data)
      handleSignalingMessage(message)
    }

    socketRef.current.onerror = (error) => {
      console.error("WebSocket error:", error)
    }

    socketRef.current.onclose = () => {
      console.log("WebSocket connection closed")
    }
  }

  const handleSignalingMessage = async (message: any) => {
    const { type, from, username: peerUsername } = message

    switch (type) {
      case "join":
        // New peer joined - create offer
        if (from !== clientId) {
          console.log(`New peer joined: ${from} (${peerUsername})`)
          const peerConnection = createPeerConnection(from, peerUsername)

          // Create and send offer
          if (localStream && peerConnection) {
            try {
              const offer = await peerConnection.createOffer()
              await peerConnection.setLocalDescription(offer)

              sendSignalingMessage({
                type: "offer",
                to: from,
                sdp: peerConnection.localDescription,
              })
            } catch (error) {
              console.error("Error creating offer:", error)
            }
          }
        }
        break

      case "offer":
        // Received an offer - create answer
        console.log(`Received offer from: ${from} (${peerUsername})`)
        if (!peers[from]) {
          const peerConnection = createPeerConnection(from, peerUsername)

          if (peerConnection && message.sdp) {
            try {
              await peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp))
              const answer = await peerConnection.createAnswer()
              await peerConnection.setLocalDescription(answer)

              sendSignalingMessage({
                type: "answer",
                to: from,
                sdp: peerConnection.localDescription,
              })
            } catch (error) {
              console.error("Error creating answer:", error)
            }
          }
        }
        break

      case "answer":
        // Received an answer to our offer
        console.log(`Received answer from: ${from}`)
        const peerConnection = peers[from]?.connection

        if (peerConnection && message.sdp) {
          try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp))
          } catch (error) {
            console.error("Error setting remote description:", error)
          }
        }
        break

      case "ice-candidate":
        // Add ICE candidate received from a peer
        const connection = peers[from]?.connection

        if (connection && message.candidate) {
          try {
            await connection.addIceCandidate(new RTCIceCandidate(message.candidate))
          } catch (error) {
            console.error("Error adding ICE candidate:", error)
          }
        }
        break

      case "leave":
        // Peer left - remove connection
        console.log(`Peer left: ${from} (${peerUsername})`)
        if (peers[from]) {
          if (peers[from].connection) {
            peers[from].connection.close()
          }

          setPeers((prevPeers) => {
            const newPeers = { ...prevPeers }
            delete newPeers[from]
            return newPeers
          })
        }
        break

      case "chat":
        // Chat message received
        if (message.message) {
          setChatMessages((prev) => [
            ...prev,
            {
              from,
              username: peerUsername,
              message: message.message,
              timestamp: new Date(),
            },
          ])
        }
        break
    }
  }

  const createPeerConnection = (peerId: string, peerUsername: string) => {
    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
      })

      // Add local tracks to the connection
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          peerConnection.addTrack(track, localStream)
        })
      }

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignalingMessage({
            type: "ice-candidate",
            to: peerId,
            candidate: event.candidate,
          })
        }
      }

      // Handle incoming tracks
      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams

        setPeers((prevPeers) => ({
          ...prevPeers,
          [peerId]: {
            ...prevPeers[peerId],
            stream: remoteStream,
          },
        }))
      }

      // Add the new peer to state
      setPeers((prevPeers) => ({
        ...prevPeers,
        [peerId]: {
          id: peerId,
          username: peerUsername,
          connection: peerConnection,
        },
      }))

      return peerConnection
    } catch (error) {
      console.error("Error creating peer connection:", error)
      return null
    }
  }

  const sendSignalingMessage = (message: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message))
    }
  }

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled
      })
      setIsMuted(!isMuted)
    }
  }

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled
      })
      setIsVideoOff(!isVideoOff)
    }
  }

  const toggleScreenShare = async () => {
    try {
      if (isScreenSharing) {
        // Revert to camera
        if (originalStream.current && localVideoRef.current) {
          const tracks =
            localVideoRef.current.srcObject instanceof MediaStream
              ? (localVideoRef.current.srcObject as MediaStream).getVideoTracks()
              : []

          if (tracks.length > 0) {
            tracks.forEach((track) => track.stop())
          }

          setLocalStream(originalStream.current)
          localVideoRef.current.srcObject = originalStream.current

          // Update connections with original stream
          Object.values(peers).forEach((peer) => {
            if (peer.connection) {
              const senders = peer.connection.getSenders()
              const videoSender = senders.find((sender) => sender.track?.kind === "video")

              if (videoSender && originalStream.current) {
                const videoTrack = originalStream.current.getVideoTracks()[0]
                if (videoTrack) {
                  videoSender.replaceTrack(videoTrack)
                }
              }
            }
          })
        }

        if (screenStream.current) {
          screenStream.current.getTracks().forEach((track) => track.stop())
          screenStream.current = null
        }
      } else {
        // Share screen
        screenStream.current = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        })

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream.current

          // Replace video tracks in all peer connections
          Object.values(peers).forEach((peer) => {
            if (peer.connection) {
              const senders = peer.connection.getSenders()
              const videoSender = senders.find((sender) => sender.track?.kind === "video")

              if (videoSender && screenStream.current) {
                const videoTrack = screenStream.current.getVideoTracks()[0]
                if (videoTrack) {
                  videoSender.replaceTrack(videoTrack)
                }
              }
            }
          })
        }
      }

      setIsScreenSharing(!isScreenSharing)
    } catch (error) {
      console.error("Error sharing screen:", error)
    }
  }

  const sendChatMessage = () => {
    if (!messageInput.trim()) return

    // Add message to local chat
    setChatMessages((prev) => [
      ...prev,
      {
        from: clientId,
        username: username,
        message: messageInput,
        timestamp: new Date(),
      },
    ])

    // Send message to other peers
    sendSignalingMessage({
      type: "chat",
      message: messageInput,
    })

    setMessageInput("")
  }

  const handleEndCall = () => {
    window.location.href = "/"
  }

  return (
    <div className="flex h-screen flex-col bg-gray-900">
      <header className="flex items-center justify-between border-b border-gray-700 bg-gray-800 p-4">
        <h1 className="text-xl font-bold text-white">Room: {roomId}</h1>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-green-500 px-3 py-1 text-sm text-white">
            {Object.keys(peers).length + 1} participants
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4">
          <div className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Local video */}
            <div className="video-container aspect-video bg-gray-800">
              <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              <div className="video-overlay">
                {username} (You) {isScreenSharing && "· Sharing screen"}
              </div>
            </div>

            {/* Remote videos */}
            {Object.values(peers).map((peer) => (
              <div key={peer.id} className="video-container aspect-video bg-gray-800">
                {peer.stream ? (
                  <video autoPlay playsInline className="h-full w-full object-cover" srcObject={peer.stream} />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <span className="text-white">Connecting...</span>
                  </div>
                )}
                <div className="video-overlay">{peer.username}</div>
              </div>
            ))}
          </div>
        </main>

        <aside className="hidden w-80 border-l border-gray-700 bg-gray-800 md:block">
          <Tabs defaultValue="chat">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="participants">Participants</TabsTrigger>
            </TabsList>

            <TabsContent value="chat" className="h-[calc(100vh-160px)] flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4 chat-container">
                {chatMessages.length === 0 ? (
                  <p className="text-center text-sm text-gray-400">No messages yet</p>
                ) : (
                  chatMessages.map((msg, index) => (
                    <div key={index} className={`flex flex-col ${msg.from === clientId ? "items-end" : "items-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-lg p-3 ${
                          msg.from === clientId
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground"
                        }`}
                      >
                        <p className="text-sm font-semibold">{msg.username}</p>
                        <p>{msg.message}</p>
                      </div>
                      <span className="mt-1 text-xs text-gray-400">
                        {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-gray-700 p-4">
                <div className="flex gap-2">
                  <Input
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="Type a message..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        sendChatMessage()
                      }
                    }}
                    className="bg-gray-700 text-white"
                  />
                  <Button onClick={sendChatMessage}>Send</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="participants" className="p-4">
              <ul className="space-y-2">
                <li className="flex items-center justify-between rounded-lg bg-gray-700 p-3">
                  <span>{username} (You)</span>
                  <span className="rounded-full bg-green-500 px-2 py-1 text-xs text-white">Host</span>
                </li>
                {Object.values(peers).map((peer) => (
                  <li key={peer.id} className="rounded-lg bg-gray-700 p-3">
                    {peer.username}
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <div className="controls-container">
        <button
          onClick={toggleMute}
          className={`control-button ${isMuted ? "bg-red-500" : "bg-gray-700"}`}
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? "🔇" : "🎤"}
        </button>

        <button
          onClick={toggleVideo}
          className={`control-button ${isVideoOff ? "bg-red-500" : "bg-gray-700"}`}
          aria-label={isVideoOff ? "Turn on camera" : "Turn off camera"}
        >
          {isVideoOff ? "🚫" : "📹"}
        </button>

        <button
          onClick={toggleScreenShare}
          className={`control-button ${isScreenSharing ? "bg-green-500" : "bg-gray-700"}`}
          aria-label={isScreenSharing ? "Stop sharing" : "Share screen"}
        >
          📊
        </button>

        <button onClick={handleEndCall} className="control-button bg-red-600" aria-label="End call">
          📞
        </button>
      </div>
    </div>
  )
}

