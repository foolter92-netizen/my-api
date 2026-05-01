'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Zap, Key, BarChart3, CreditCard, Copy, Plus, Trash2, Eye, EyeOff,
  LayoutDashboard, LogOut, Settings, ChevronRight, Activity, DollarSign, Hash
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

export default function DashboardPage() {
  const { user, token, loading, logout } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('overview');
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [usageStats, setUsageStats] = useState<any>(null);
  const [balanceData, setBalanceData] = useState<any>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [newKeyName, setNewKeyName] = useState('');
  const [topupAmount, setTopupAmount] = useState('');
  const [models, setModels] = useState<any[]>([]);

  const loadDashboardData = useCallback(async () => {
    try {
      const [keysRes, usageRes, balanceRes, modelsRes] = await Promise.all([
        apiFetch('/api/keys'),
        apiFetch('/api/user/usage?days=30'),
        apiFetch('/api/user/balance'),
        apiFetch('/api/models'),
      ]);

      if (keysRes.ok) {
        const keysData = await keysRes.json();
        setApiKeys(keysData.data || []);
      }
      if (usageRes.ok) {
        const usageData = await usageRes.json();
        setUsageStats(usageData.data);
      }
      if (balanceRes.ok) {
        const balanceJson = await balanceRes.json();
        setBalanceData(balanceJson.data);
      }
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        setModels(modelsData.data || []);
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (token && user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadDashboardData();
    }
  }, [token, user, loadDashboardData]);

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;
    const res = await apiFetch('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: newKeyName }),
    });
    if (res.ok) {
      setNewKeyName('');
      loadDashboardData();
    }
  };

  const deleteApiKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to delete this API key?')) return;
    await apiFetch('/api/keys', {
      method: 'DELETE',
      body: JSON.stringify({ keyId }),
    });
    loadDashboardData();
  };

  const topUpBalance = async () => {
    const amount = parseFloat(topupAmount);
    if (!amount || amount <= 0) return;
    const res = await apiFetch('/api/user/balance', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    if (res.ok) {
      setTopupAmount('');
      loadDashboardData();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const isAdmin = user.role === 'admin';
  const userBalance = typeof user.balance === 'number' ? user.balance : parseFloat(String(user.balance || 0));

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <nav className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 bg-primary rounded flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold">AI Gateway</span>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="font-mono">
                <DollarSign className="h-3 w-3 mr-1" />
                {userBalance.toFixed(2)} USD
              </Badge>
              <span className="text-sm text-muted-foreground hidden sm:inline">{user.email}</span>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-56 border-r border-border/40 min-h-[calc(100vh-56px)] p-4 hidden md:block">
          <nav className="space-y-1">
            {[
              { id: 'overview', label: 'Overview', icon: LayoutDashboard },
              { id: 'keys', label: 'API Keys', icon: Key },
              { id: 'usage', label: 'Usage', icon: BarChart3 },
              { id: 'billing', label: 'Billing', icon: CreditCard },
              { id: 'models', label: 'Models', icon: Zap },
              ...(isAdmin ? [
                { id: 'admin', label: 'Admin Panel', icon: Settings },
              ] : []),
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'admin') {
                    router.push('/admin');
                  } else {
                    setActiveTab(tab.id);
                  }
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
                {tab.id === 'admin' && <ChevronRight className="h-3 w-3 ml-auto" />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 max-w-6xl">
          {/* Mobile tabs */}
          <div className="flex gap-2 mb-6 md:hidden overflow-x-auto">
            {['overview', 'keys', 'usage', 'billing', 'models'].map(tab => (
              <Button
                key={tab}
                variant={activeTab === tab ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab(tab)}
                className="capitalize"
              >
                {tab}
              </Button>
            ))}
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => router.push('/admin')}>
                Admin
              </Button>
            )}
          </div>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold">Dashboard</h1>
                <p className="text-muted-foreground">Welcome back, {user.name || user.email}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-primary" />
                      <span className="text-sm text-muted-foreground">Balance</span>
                    </div>
                    <p className="text-2xl font-bold mt-1">${userBalance.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-primary" />
                      <span className="text-sm text-muted-foreground">API Keys</span>
                    </div>
                    <p className="text-2xl font-bold mt-1">{apiKeys.length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Hash className="h-4 w-4 text-primary" />
                      <span className="text-sm text-muted-foreground">Total Tokens</span>
                    </div>
                    <p className="text-2xl font-bold mt-1">
                      {usageStats?.summary?.total_tokens ? Number(usageStats.summary.total_tokens).toLocaleString() : '0'}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-primary" />
                      <span className="text-sm text-muted-foreground">Requests</span>
                    </div>
                    <p className="text-2xl font-bold mt-1">
                      {usageStats?.summary?.total_requests || '0'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Quick Start */}
              <Card>
                <CardHeader>
                  <CardTitle>Quick Start</CardTitle>
                  <CardDescription>Use this code to make your first API call</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="bg-muted/50 p-4 rounded-lg text-sm font-mono overflow-x-auto">
                    <code>
{`curl ${typeof window !== 'undefined' ? window.location.origin : 'https://your-gateway.com'}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKeys[0]?.key || 'sk-live-xxxxxxxx'}" \\
  -d '{
    "model": "deepseek-v3.1",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
                    </code>
                  </pre>
                </CardContent>
              </Card>
            </div>
          )}

          {/* API Keys Tab */}
          {activeTab === 'keys' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold">API Keys</h1>
                  <p className="text-muted-foreground">Manage your API keys</p>
                </div>
              </div>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Key name (e.g., Production)"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="max-w-xs"
                    />
                    <Button onClick={createApiKey} disabled={!newKeyName.trim()}>
                      <Plus className="h-4 w-4 mr-1" /> Create Key
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {apiKeys.map((apiKey) => (
                  <Card key={apiKey.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{apiKey.name}</span>
                            <Badge variant={apiKey.status === 'active' ? 'default' : 'destructive'}>
                              {apiKey.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                              {showKey[apiKey.id] ? apiKey.key : `${apiKey.key.substring(0, 12)}...`}
                            </code>
                            <Button variant="ghost" size="sm" onClick={() => setShowKey(prev => ({ ...prev, [apiKey.id]: !prev[apiKey.id] }))}>
                              {showKey[apiKey.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(apiKey.key)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          {apiKey.last_used_at && (
                            <p className="text-xs text-muted-foreground">
                              Last used: {new Date(apiKey.last_used_at).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600" onClick={() => deleteApiKey(apiKey.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {apiKeys.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No API keys yet. Create one above.</p>
                )}
              </div>
            </div>
          )}

          {/* Usage Tab */}
          {activeTab === 'usage' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold">Usage</h1>
                <p className="text-muted-foreground">Monitor your API usage and costs</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <span className="text-sm text-muted-foreground">Total Tokens (30d)</span>
                    <p className="text-2xl font-bold mt-1">
                      {usageStats?.summary?.total_tokens ? Number(usageStats.summary.total_tokens).toLocaleString() : '0'}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <span className="text-sm text-muted-foreground">Total Cost (30d)</span>
                    <p className="text-2xl font-bold mt-1">
                      ${usageStats?.summary?.total_cost ? Number(usageStats.summary.total_cost).toFixed(4) : '0.00'}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <span className="text-sm text-muted-foreground">Total Requests (30d)</span>
                    <p className="text-2xl font-bold mt-1">
                      {usageStats?.summary?.total_requests || '0'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Model Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  {usageStats?.modelBreakdown?.length > 0 ? (
                    <div className="space-y-3">
                      {usageStats.modelBreakdown.map((m: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                          <div>
                            <span className="font-medium font-mono text-sm">{m.model}</span>
                          </div>
                          <div className="flex gap-6 text-sm text-muted-foreground">
                            <span>{Number(m.requests).toLocaleString()} requests</span>
                            <span>{Number(m.tokens).toLocaleString()} tokens</span>
                            <span>${Number(m.cost).toFixed(4)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-4">No usage data yet</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Billing Tab */}
          {activeTab === 'billing' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold">Billing</h1>
                <p className="text-muted-foreground">Manage your balance and view transactions</p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Current Balance</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-4xl font-bold">${userBalance.toFixed(2)}</p>
                  <div className="flex gap-2 mt-4">
                    <Input
                      type="number"
                      placeholder="Amount (USD)"
                      value={topupAmount}
                      onChange={(e) => setTopupAmount(e.target.value)}
                      className="max-w-xs"
                      min="1"
                    />
                    <Button onClick={topUpBalance} disabled={!topupAmount}>
                      <CreditCard className="h-4 w-4 mr-1" /> Top Up
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recent Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                  {balanceData?.transactions?.length > 0 ? (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {balanceData.transactions.map((tx: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                          <div>
                            <span className="text-sm">{tx.description || tx.type}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                              {new Date(tx.created_at).toLocaleString()}
                            </span>
                          </div>
                          <span className={`font-mono text-sm ${Number(tx.amount) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {Number(tx.amount) >= 0 ? '+' : ''}{Number(tx.amount).toFixed(4)} USD
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-4">No transactions yet</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Models Tab */}
          {activeTab === 'models' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold">Available Models</h1>
                <p className="text-muted-foreground">All models you can access through the API</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {models.map((model: any, i: number) => (
                  <Card key={i}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{model.name}</CardTitle>
                        <Badge variant="secondary">{model.owned_by}</Badge>
                      </div>
                      <CardDescription className="font-mono text-xs">{model.id}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Input: </span>
                          <span className="font-mono">${model.pricing?.input || 0}/1M</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Output: </span>
                          <span className="font-mono">${model.pricing?.output || 0}/1M</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Max Tokens: </span>
                          <span className="font-mono">{model.max_tokens?.toLocaleString()}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
