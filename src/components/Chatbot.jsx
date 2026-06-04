import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, User, Bot, AlertTriangle, Copy, Check, Plus, Clock, Trash2, ChevronLeft } from 'lucide-react';

const Chatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  
  const [chats, setChats] = useState(() => {
    try {
      const saved = localStorage.getItem('lankaroute-chats');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return [{ id: Date.now().toString(), title: 'New Chat', messages: [] }];
  });

  const [currentChatId, setCurrentChatId] = useState(() => {
    try {
      const saved = localStorage.getItem('lankaroute-chats');
      if (saved) return JSON.parse(saved)[0]?.id || Date.now().toString();
    } catch(e) {}
    return Date.now().toString();
  });
  
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef(null);

  const apiKey = import.meta.env.VITE_GROQ_API_KEY;

  const currentChat = chats.find(c => c.id === currentChatId) || chats[0];
  const messages = currentChat?.messages || [];

  useEffect(() => {
    localStorage.setItem('lankaroute-chats', JSON.stringify(chats));
  }, [chats]);

  const updateCurrentChatMessages = (newMessages) => {
    setChats(prevChats => prevChats.map(chat => {
      if (chat.id === currentChatId) {
        const msgs = typeof newMessages === 'function' ? newMessages(chat.messages) : newMessages;
        let newTitle = chat.title;
        // Auto title generation based on first user message
        if (chat.title === 'New Chat') {
          const firstUserMsg = msgs.find(m => m.role === 'user');
          if (firstUserMsg) {
            newTitle = firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
          }
        }
        return { ...chat, title: newTitle, messages: msgs };
      }
      return chat;
    }));
  };

  useEffect(() => {
    if (!apiKey || apiKey === 'your_groq_key_here') {
      setHasApiKey(false);
      if (messages.length === 0) {
        updateCurrentChatMessages([
          { role: 'system', content: '⚠️ **API Key Missing**\nTo use this completely FREE AI, please add your Groq API key to the `.env.local` file:\n`VITE_GROQ_API_KEY=gsk_...`\n\nYou can get a free key from [Groq Console](https://console.groq.com/keys).', timestamp: new Date().toISOString() }
        ]);
      }
    } else {
      setHasApiKey(true);
      if (messages.length === 0) {
        updateCurrentChatMessages([
          { role: 'ai', content: 'ආයුබෝවන්! මම LankaRoute AI සංචාරක සහයකයා. ශ්‍රී ලංකාවේ සංචාරය කිරීම ගැන ඕනෑම ප්‍රශ්නයක් මගෙන් අහන්න. / Hello! I am the LankaRoute AI Travel Assistant. Ask me anything about traveling in Sri Lanka.', timestamp: new Date().toISOString() }
        ]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, currentChatId]);

  useEffect(() => {
    if (!showHistory) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, showHistory]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !hasApiKey || isLoading) return;

    const userMsg = inputMessage.trim();
    setInputMessage('');
    updateCurrentChatMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp: new Date().toISOString() }]);
    setIsLoading(true);

    try {
      const groqMessages = [
        { role: 'system', content: "You are an expert travel assistant exclusively for Sri Lanka tourism (LankaRoute). CRITICAL RULE: You MUST reply in the exact same language the user uses. If the user asks in Sinhala (සිංහල), you MUST reply ONLY in Sinhala. If the user asks in English, you MUST reply ONLY in English. NEVER use Tamil or any other languages. DO NOT use any Markdown formatting like **bold** or *italics* in your response. Output PLAIN TEXT ONLY. ONLY answer questions related to travel, tourism, places to visit, history, routes, and culture in Sri Lanka." }
      ];

      for (const m of messages) {
        if (m.role === 'system') continue;
        groqMessages.push({
          role: m.role === 'ai' ? 'assistant' : 'user',
          content: m.content
        });
      }

      groqMessages.push({ role: 'user', content: userMsg });

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: groqMessages
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      let text = data.choices?.[0]?.message?.content || "No response received.";
      text = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');

      updateCurrentChatMessages(prev => [...prev, { role: 'ai', content: text, timestamp: new Date().toISOString() }]);
    } catch (error) {
      console.error('Groq API Error:', error);
      updateCurrentChatMessages(prev => [...prev, { role: 'system', content: `❌ Error: Failed to get a response from the AI.\nDetails: ${error.message}`, timestamp: new Date().toISOString() }]);
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

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const startNewChat = () => {
    const newChat = { id: Date.now().toString(), title: 'New Chat', messages: [] };
    setChats([newChat, ...chats]);
    setCurrentChatId(newChat.id);
    setShowHistory(false);
  };

  const switchChat = (id) => {
    setCurrentChatId(id);
    setShowHistory(false);
  };

  const deleteChat = (e, id) => {
    e.stopPropagation();
    const newChats = chats.filter(c => c.id !== id);
    if (newChats.length === 0) {
      const freshChat = { id: Date.now().toString(), title: 'New Chat', messages: [] };
      setChats([freshChat]);
      setCurrentChatId(freshChat.id);
    } else {
      setChats(newChats);
      if (currentChatId === id) setCurrentChatId(newChats[0].id);
    }
  };

  const handleOpenBot = () => {
    setIsOpen(true);
    startNewChat();
  };

  return (
    <>
      {!isOpen && (
        <button 
          className="chatbot-toggle-btn pulse-animation"
          onClick={handleOpenBot}
          title="LankaRoute AI Travel Assistant"
        >
          <Bot size={28} color="#fff" strokeWidth={1.5} />
          <div className="online-indicator"></div>
        </button>
      )}

      {isOpen && (
        <div className="chatbot-window glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="chatbot-header">
            <div className="chatbot-title">
              {showHistory ? (
                <button 
                  onClick={() => setShowHistory(false)} 
                  title="Back to Chat"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', marginRight: '6px' }}
                >
                  <ChevronLeft size={18} color="#06b6d4" />
                </button>
              ) : (
                <Bot size={18} color="#06b6d4" style={{ marginRight: '6px' }} />
              )}
              <span>{showHistory ? 'Chat History' : 'AI Travel Guide'}</span>
            </div>
            <div className="chatbot-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {!showHistory && (
                <>
                  <button onClick={startNewChat} title="New Chat" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                    <Plus size={18} />
                  </button>
                  <button onClick={() => setShowHistory(true)} title="Chat History" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                    <Clock size={18} />
                  </button>
                </>
              )}
              <button className="chatbot-close-btn" onClick={() => setIsOpen(false)}>
                <X size={18} />
              </button>
            </div>
          </div>

          {showHistory ? (
            <div className="chatbot-history-panel" style={{ flex: 1, overflowY: 'auto', padding: '12px', background: '#0b1120' }}>
              {chats.map(chat => (
                <div 
                  key={chat.id} 
                  onClick={() => switchChat(chat.id)}
                  style={{ 
                    padding: '12px', 
                    borderRadius: '8px', 
                    marginBottom: '8px', 
                    cursor: 'pointer',
                    background: chat.id === currentChatId ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${chat.id === currentChatId ? 'rgba(6, 182, 212, 0.3)' : 'transparent'}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px', color: '#e2e8f0', paddingRight: '10px' }}>
                    {chat.title}
                  </div>
                  <button 
                    onClick={(e) => deleteChat(e, chat.id)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', opacity: 0.7 }}
                    title="Delete Chat"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="chatbot-messages">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`chat-message ${msg.role}`}>
                    <div className="chat-message-icon">
                      {msg.role === 'user' ? <User size={14} /> : msg.role === 'ai' ? <Bot size={14} /> : <AlertTriangle size={14} />}
                    </div>
                    <div className="chat-message-content">
                      {msg.content}
                      <div style={{ fontSize: '9px', color: msg.role === 'user' ? '#93c5fd' : '#64748b', textAlign: 'right', marginTop: '4px', fontStyle: 'italic' }}>
                        {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                      {msg.role === 'ai' && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                          <button 
                            className="copy-btn" 
                            onClick={() => handleCopy(msg.content, idx)}
                            title="Copy to clipboard"
                            style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '4px', padding: '4px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.2s' }}
                          >
                            {copiedIndex === idx ? <Check size={12} color="#10b981" /> : <Copy size={12} color="#94a3b8" />}
                          </button>
                        </div>
                      )}
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
            </>
          )}
        </div>
      )}
    </>
  );
};

export default Chatbot;
