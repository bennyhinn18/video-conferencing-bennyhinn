"use client"

import { json } from "@remix-run/node"
import { useLoaderData } from "@remix-run/react"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { useState } from "react"

export const loader = async () => {
  return json({
    title: "Video Conference App",
  })
}

export default function Index() {
  const { title } = useLoaderData<typeof loader>()
  const [roomId, setRoomId] = useState("")
  const [username, setUsername] = useState("")
  const [newRoomUsername, setNewRoomUsername] = useState("")

  const handleCreateRoom = async () => {
    if (!newRoomUsername.trim()) {
      alert("Please enter your name")
      return
    }

    try {
      const response = await fetch("http://localhost:8080/api/rooms", {
        method: "POST",
      })
      const data = await response.json()
      window.location.href = `/room/${data.roomId}?username=${encodeURIComponent(newRoomUsername)}`
    } catch (error) {
      console.error("Error creating room:", error)
      alert("Failed to create room. Please try again.")
    }
  }

  const handleJoinRoom = () => {
    if (!roomId.trim() || !username.trim()) {
      alert("Please enter both room ID and your name")
      return
    }
    window.location.href = `/room/${roomId}?username=${encodeURIComponent(username)}`
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-blue-100 p-4">
      <div className="w-full max-w-4xl">
        <h1 className="mb-8 text-center text-4xl font-bold text-primary">{title}</h1>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Create New Meeting</CardTitle>
              <CardDescription>Start a new video conference</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Input
                    placeholder="Your Name"
                    value={newRoomUsername}
                    onChange={(e) => setNewRoomUsername(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleCreateRoom} className="w-full">
                Create New Meeting
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Join Meeting</CardTitle>
              <CardDescription>Enter a meeting code to join</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Input placeholder="Meeting Code" value={roomId} onChange={(e) => setRoomId(e.target.value)} />
                </div>
                <div>
                  <Input placeholder="Your Name" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleJoinRoom} className="w-full">
                Join Meeting
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="mt-12 text-center">
          <h2 className="mb-4 text-2xl font-bold">Features</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            <div className="rounded-lg bg-white p-4 shadow">
              <h3 className="text-lg font-semibold text-primary">Video Conferencing</h3>
              <p className="text-gray-600">Connect with multiple participants</p>
            </div>
            <div className="rounded-lg bg-white p-4 shadow">
              <h3 className="text-lg font-semibold text-primary">Chat</h3>
              <p className="text-gray-600">Send messages during meetings</p>
            </div>
            <div className="rounded-lg bg-white p-4 shadow">
              <h3 className="text-lg font-semibold text-primary">Screen Sharing</h3>
              <p className="text-gray-600">Share your screen with others</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

