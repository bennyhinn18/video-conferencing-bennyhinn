package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

// Room stores information about connected clients
type Room struct {
	Clients map[string]*Client
	mu      sync.Mutex
}

// Client represents a connected websocket client
type Client struct {
	Conn     *websocket.Conn
	ID       string
	RoomID   string
	Username string
}

// Message represents a message exchanged between clients
type Message struct {
	Type      string          `json:"type"`
	From      string          `json:"from"`
	To        string          `json:"to,omitempty"`
	RoomID    string          `json:"roomId"`
	Username  string          `json:"username,omitempty"`
	SDP       json.RawMessage `json:"sdp,omitempty"`
	Candidate json.RawMessage `json:"candidate,omitempty"`
}

var (
	rooms = make(map[string]*Room)
	mu    sync.Mutex
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow connections from any origin
	},
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", handleWebSocket)
	mux.HandleFunc("/api/rooms", handleRooms)

	// Apply CORS middleware
	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
	}).Handler(mux)

	log.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", handler))
}

func handleRooms(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		// Create a new room
		roomID := generateRoomID()
		mu.Lock()
		rooms[roomID] = &Room{
			Clients: make(map[string]*Client),
		}
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"roomId": roomID})
		return
	}

	if r.Method == "GET" {
		// List active rooms
		mu.Lock()
		roomIDs := make([]string, 0, len(rooms))
		for id := range rooms {
			roomIDs = append(roomIDs, id)
		}
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string][]string{"rooms": roomIDs})
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("roomId")
	clientID := r.URL.Query().Get("clientId")
	username := r.URL.Query().Get("username")

	if roomID == "" || clientID == "" || username == "" {
		http.Error(w, "Missing required parameters", http.StatusBadRequest)
		return
	}

	mu.Lock()
	room, exists := rooms[roomID]
	if !exists {
		rooms[roomID] = &Room{
			Clients: make(map[string]*Client),
		}
		room = rooms[roomID]
	}
	mu.Unlock()

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Error upgrading to WebSocket:", err)
		return
	}

	client := &Client{
		Conn:     conn,
		ID:       clientID,
		RoomID:   roomID,
		Username: username,
	}

	// Add client to room
	room.mu.Lock()
	room.Clients[clientID] = client
	room.mu.Unlock()

	// Notify other clients about new peer
	notifyRoom(roomID, clientID, "join", username)

	// Listen for messages from this client
	go handleMessages(client, room)
}

func handleMessages(client *Client, room *Room) {
	defer func() {
		client.Conn.Close()
		room.mu.Lock()
		delete(room.Clients, client.ID)
		room.mu.Unlock()

		// If room is empty, remove it
		if len(room.Clients) == 0 {
			mu.Lock()
			delete(rooms, client.RoomID)
			mu.Unlock()
		} else {
			// Notify others that peer has left
			notifyRoom(client.RoomID, client.ID, "leave", client.Username)
		}
	}()

	for {
		messageType, payload, err := client.Conn.ReadMessage()
		if err != nil {
			log.Println("Error reading message:", err)
			break
		}

		if messageType != websocket.TextMessage {
			continue
		}

		var msg Message
		if err := json.Unmarshal(payload, &msg); err != nil {
			log.Println("Error unmarshaling message:", err)
			continue
		}

		msg.From = client.ID
		msg.RoomID = client.RoomID

		// Handle different message types
		switch msg.Type {
		case "offer", "answer", "ice-candidate":
			// Forward message to specific peer
			if msg.To != "" {
				forwardMessage(msg)
			}
		case "chat":
			// Broadcast chat message to everyone in the room
			broadcastToRoom(client.RoomID, msg)
		}
	}
}

func notifyRoom(roomID, clientID, eventType, username string) {
	msg := Message{
		Type:     eventType,
		From:     clientID,
		RoomID:   roomID,
		Username: username,
	}

	broadcastToRoom(roomID, msg)
}

func forwardMessage(msg Message) {
	mu.Lock()
	room, exists := rooms[msg.RoomID]
	mu.Unlock()

	if !exists {
		return
	}

	room.mu.Lock()
	targetClient, exists := room.Clients[msg.To]
	room.mu.Unlock()

	if !exists {
		return
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Println("Error marshaling message:", err)
		return
	}

	if err := targetClient.Conn.WriteMessage(websocket.TextMessage, msgBytes); err != nil {
		log.Println("Error sending message:", err)
	}
}

func broadcastToRoom(roomID string, msg Message) {
	mu.Lock()
	room, exists := rooms[roomID]
	mu.Unlock()

	if !exists {
		return
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Println("Error marshaling message:", err)
		return
	}

	room.mu.Lock()
	for _, client := range room.Clients {
		// Don't send message back to sender
		if client.ID == msg.From {
			continue
		}

		if err := client.Conn.WriteMessage(websocket.TextMessage, msgBytes); err != nil {
			log.Println("Error broadcasting message:", err)
		}
	}
	room.mu.Unlock()
}

// Helper function to generate a random room ID
func generateRoomID() string {
	// In a real app, you'd use a more sophisticated ID generator
	return "room-" + randomString(8)
}

func randomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[i%len(charset)]
	}
	return string(b)
}

