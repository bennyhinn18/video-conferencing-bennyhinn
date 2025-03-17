"use client"

import { json } from "@remix-run/node"
import { useLoaderData } from "@remix-run/react"
import { useState, useEffect } from "react"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import VideoCall from "../../components/video-call"

export const loader = async ({ params }: any) => {
  return json({
    roomId: params.roomId,
  })
}

export default function RoomPage() {
  const { roomId } = useLoaderData<typeof loader>()
  const [username, setUsername] = useState("")
  const [isJoining, setIsJoining] = useState(true)

  useEffect(() => {
    // Get username from URL query param
    const params = new URLSearchParams(window.location.search)
    const usernameParam = params.get("username")

    if (usernameParam) {
      setUsername(usernameParam)
      setIsJoining(false)
    }
  }, [])

  const handleJoinRoom = () => {
    if (!username.trim()) {
      alert("Please enter your name")
      return
    }
    setIsJoining(false)
  }

  if (isJoining) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">Join Meeting</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-center text-sm text-gray-500">Room ID: {roomId}</p>
              <Input placeholder="Your Name" value={username} onChange={(e) => setUsername(e.target.value)} />
              <Button onClick={handleJoinRoom} className="w-full">
                Join Now
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <VideoCall roomId={roomId} username={username} />
}

