import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, User, Bot, AlertTriangle } from 'lucide-react';
import { GoogleGenerativeAI } from '@google/generative-ai';

const Chatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(true);
  const messagesEndRef = useRef(null);

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  useEffect(() => {
    if (!apiKey || apiKey === 'your_openai_key_here') {
      setHasApiKey(false);
      setMessages([
        { role: 'system', content: '⚠️ **API Key Missing**\nTo use this AI, please add your OpenAI API key to the `.env.local` file:\n`VITE_OPENAI_API_KEY=sk-...`\n\nYou can get a key from [OpenAI Platform](https://platform.openai.com/api-keys).' }
      ]);
    } else {
      setMessages([
        { role: 'ai', content: 'ආයුබෝවන්! මම LankaRoute AI සංචාරක සහයකයා. ශ්‍රී ලංකාවේ සංචාරය කිරීම ගැන ඕනෑම ප්‍රශ්නයක් මගෙන් අහන්න. / Hello! I am the LankaRoute AI Travel Assistant. Ask me anything about traveling in Sri Lanka.' }
      ]);
    }
  }, [apiKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !hasApiKey || isLoading) return;

    const userMsg = inputMessage.trim();
    setInputMessage('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      // Construct chat history for OpenAI
      const openAIMessages = [
        { role: 'system', content: "You are an expert travel assistant exclusively for Sri Lanka tourism (LankaRoute). You speak both English and Sinhala perfectly. ONLY answer questions related to travel, tourism, places to visit, history, routes, and culture in Sri Lanka." }
      ];

      for (const m of messages) {
        if (m.role === 'system') continue;
        openAIMessages.push({
          role: m.role === 'ai' ? 'assistant' : 'user',
          content: m.content
        });
      }

      openAIMessages.push({ role: 'user', content: userMsg });

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: openAIMessages
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "No response received.";

      setMessages(prev => [...prev, { role: 'ai', content: text }]);
    } catch (error) {
      console.error('OpenAI API Error:', error);
      setMessages(prev => [...prev, { role: 'system', content: `❌ Error: Failed to get a response from the AI.\nDetails: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button 
          className="chatbot-toggle-btn pulse-animation"
          onClick={() => setIsOpen(true)}
          title="LankaRoute AI Travel Assistant"
        >
          <Bot size={28} color="#fff" strokeWidth={1.5} />
          <div className="online-indicator"></div>
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="chatbot-window glass-panel">
          <div className="chatbot-header">
            <div className="chatbot-title">
              <Bot size={18} color="#06b6d4" />
              <span>AI Travel Guide</span>
            </div>
            <button className="chatbot-close-btn" onClick={() => setIsOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="chatbot-messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.role}`}>
                <div className="chat-message-icon">
                  {msg.role === 'user' ? <User size={14} /> : msg.role === 'ai' ? <Bot size={14} /> : <AlertTriangle size={14} />}
                </div>
                <div className="chat-message-content">
                  {/* Basic markdown rendering for links/bold could be added here. Using dangerouslySetInnerHTML is risky, so we just render plain text or simple parsing. */}
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="chat-message ai">
                <div className="chat-message-icon"><Bot size={14} /></div>
                <div className="chat-message-content loading-dots">
                  <span>.</span><span>.</span><span>.</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chatbot-input-area">
            <textarea
              className="chatbot-input"
              placeholder="Ask about Sri Lanka travel..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={!hasApiKey || isLoading}
            />
            <button 
              className="chatbot-send-btn" 
              onClick={handleSendMessage}
              disabled={!hasApiKey || isLoading || !inputMessage.trim()}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Chatbot;
