'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Zap, Shield, Globe, Code, ArrowRight, Terminal, Key, BarChart3,
  Cpu, RefreshCw, Server, Check
} from 'lucide-react';

// ============================================
// LANDING PAGE
// ============================================

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <Cpu className="h-12 w-12 text-primary animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
                <Zap className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold">AI Gateway</span>
            </div>
            <div className="flex items-center gap-4">
              <AuthModal mode="login" trigger={
                <Button variant="ghost">Sign In</Button>
              } />
              <AuthModal mode="register" trigger={
                <Button>Get Started</Button>
              } />
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
          <div className="text-center space-y-8">
            <Badge variant="secondary" className="px-4 py-1.5 text-sm">
              OpenAI-Compatible API
            </Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight">
              One API Key.
              <br />
              <span className="text-primary">Every AI Model.</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Access DeepSeek, GPT, and more through a single unified API.
              Automatic failover, load balancing, and pay-per-token pricing.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <AuthModal mode="register" trigger={
                <Button size="lg" className="text-lg px-8">
                  Start for Free <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              } />
              <Button size="lg" variant="outline" className="text-lg px-8" onClick={() => document.getElementById('docs')?.scrollIntoView({ behavior: 'smooth' })}>
                <Terminal className="mr-2 h-5 w-5" /> View Docs
              </Button>
            </div>
          </div>

          {/* Code Example */}
          <div className="mt-16 max-w-3xl mx-auto">
            <Card className="border-border/50 bg-muted/30">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
                  <div className="flex gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-red-500/80" />
                    <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
                    <div className="h-3 w-3 rounded-full bg-green-500/80" />
                  </div>
                  <span className="text-xs text-muted-foreground ml-2 font-mono">quickstart.py</span>
                </div>
                <pre className="p-4 text-sm font-mono overflow-x-auto">
                  <code>
{`from openai import OpenAI

client = OpenAI(
    base_url="https://your-gateway.com/v1",
    api_key="sk-live-xxxxxxxx"
)

response = client.chat.completions.create(
    model="deepseek-v3.1",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)`}
                  </code>
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 border-t border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Built for Performance</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Enterprise-grade infrastructure powering your AI applications
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <Card key={i} className="border-border/50 hover:border-primary/50 transition-colors">
                <CardHeader>
                  <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mb-2">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">{feature.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Models */}
      <section className="py-20 border-t border-border/40 bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Available Models</h2>
            <p className="text-xl text-muted-foreground">Access top AI models through a single API</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: 'DeepSeek V3.1 Terminus', id: 'deepseek-v3.1', provider: 'MegaLLM', desc: 'Advanced reasoning model with exceptional performance on complex tasks' },
              { name: 'GPT OSS 120B', id: 'gpt-oss-120b', provider: 'MegaLLM', desc: 'Large-scale OpenAI model for high-quality text generation and analysis' },
              { name: 'GPT OSS 20B', id: 'gpt-oss-20b', provider: 'MegaLLM', desc: 'Efficient mid-size model balancing speed and quality for everyday tasks' },
            ].map((model, i) => (
              <Card key={i} className="border-border/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">{model.provider}</Badge>
                    <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Active</Badge>
                  </div>
                  <CardTitle className="text-lg mt-2">{model.name}</CardTitle>
                  <CardDescription className="font-mono text-xs">{model.id}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{model.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Docs Preview */}
      <section id="docs" className="py-20 border-t border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Quick Integration</h2>
            <p className="text-xl text-muted-foreground">Get started in minutes with our OpenAI-compatible API</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {[
              { step: '1', title: 'Create Account', desc: 'Sign up and get your API key instantly with free credits', icon: Key },
              { step: '2', title: 'Set Base URL', desc: 'Point your OpenAI client to our gateway endpoint', icon: Globe },
              { step: '3', title: 'Choose Model', desc: 'Select from our available AI models', icon: Cpu },
              { step: '4', title: 'Go Live', desc: 'Start making API calls with automatic failover', icon: Zap },
            ].map((item, i) => (
              <div key={i} className="flex gap-4 items-start">
                <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{item.title}</h3>
                  <p className="text-muted-foreground text-sm">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 bg-primary rounded flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">AI Gateway</span>
          </div>
          <p className="text-sm text-muted-foreground">2024 AI Gateway. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

// ============================================
// FEATURES DATA
// ============================================

const features = [
  {
    icon: Shield,
    title: 'Automatic Failover',
    description: 'If a provider fails or hits rate limits, requests are automatically routed to the next available provider within milliseconds.',
  },
  {
    icon: BarChart3,
    title: 'Load Balancing',
    description: 'Distribute traffic across multiple API keys using Round Robin, Least Used, or Random Weighted algorithms for optimal performance.',
  },
  {
    icon: RefreshCw,
    title: 'Key Rotation',
    description: 'Automatic key rotation prevents rate limiting. Keys are cooled down and rotated back into the pool when they recover.',
  },
  {
    icon: Server,
    title: 'Key Pool System',
    description: 'Manage hundreds or thousands of provider API keys in a unified pool. The gateway selects the best key for each request automatically.',
  },
  {
    icon: Globe,
    title: 'Multi-Provider',
    description: 'Connect multiple AI providers like MegaLLM, OpenAI, and custom APIs. Switch between them seamlessly with zero downtime.',
  },
  {
    icon: Code,
    title: 'OpenAI Compatible',
    description: 'Drop-in replacement for OpenAI API. Just change the base URL and API key - no code changes needed for existing applications.',
  },
];

// ============================================
// AUTH MODAL COMPONENT
// ============================================

function AuthModal({ mode, trigger }: { mode: 'login' | 'register'; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = mode === 'login'
        ? await login(email, password)
        : await register(email, password, name);

      if (!result.success) {
        setError(result.error || 'Authentication failed');
      } else {
        setOpen(false);
      }
    } catch {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div onClick={() => setOpen(true)}>{trigger}</div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>{mode === 'login' ? 'Sign In' : 'Create Account'}</CardTitle>
              <CardDescription>
                {mode === 'login'
                  ? 'Enter your credentials to access your account'
                  : 'Get started with free credits'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
                {error && (
                  <p className="text-sm text-red-500">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
                </Button>
                {mode === 'register' && (
                  <p className="text-xs text-muted-foreground text-center">
                    You will receive $1 free credits upon registration
                  </p>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
