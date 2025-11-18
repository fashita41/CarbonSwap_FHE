import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface CarbonCreditOrder {
  id: string;
  name: string;
  encryptedAmount: string;
  encryptedPrice: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedAmount?: number;
  decryptedPrice?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<CarbonCreditOrder[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newOrderData, setNewOrderData] = useState({ name: "", amount: "", price: "", description: "" });
  const [selectedOrder, setSelectedOrder] = useState<CarbonCreditOrder | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ amount: number | null; price: number | null }>({ amount: null, price: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [stats, setStats] = useState({ totalOrders: 0, verifiedOrders: 0, avgPrice: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const ordersList: CarbonCreditOrder[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          ordersList.push({
            id: businessId,
            name: businessData.name,
            encryptedAmount: businessId,
            encryptedPrice: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedAmount: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setOrders(ordersList);
      calculateStats(ordersList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateStats = (orders: CarbonCreditOrder[]) => {
    const totalOrders = orders.length;
    const verifiedOrders = orders.filter(o => o.isVerified).length;
    const avgPrice = orders.length > 0 
      ? orders.reduce((sum, o) => sum + o.publicValue2, 0) / orders.length 
      : 0;
    
    setStats({ totalOrders, verifiedOrders, avgPrice });
  };

  const createOrder = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingOrder(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE创建订单..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("无法获取合约");
      
      const amountValue = parseInt(newOrderData.amount) || 0;
      const priceValue = parseInt(newOrderData.price) || 0;
      const businessId = `order-${Date.now()}`;
      
      const encryptedAmount = await encrypt(contractAddress, address, amountValue);
      const encryptedPrice = await encrypt(contractAddress, address, priceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newOrderData.name,
        encryptedAmount.encryptedData,
        encryptedAmount.proof,
        priceValue,
        0,
        newOrderData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "订单创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewOrderData({ name: "", amount: "", price: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingOrder(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<{ amount: number, price: number } | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return { amount: storedValue, price: businessData.publicValue1 };
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "在链上验证解密..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return { amount: Number(clearValue), price: businessData.publicValue1 };
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "合约可用性检查成功" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "可用性检查失败" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panel">
        <div className="stat-card">
          <div className="stat-value">{stats.totalOrders}</div>
          <div className="stat-label">总订单数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.verifiedOrders}</div>
          <div className="stat-label">已验证订单</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.avgPrice.toFixed(2)}</div>
          <div className="stat-label">平均价格</div>
        </div>
      </div>
    );
  };

  const renderPriceChart = () => {
    if (orders.length === 0) return <div className="no-data-chart">暂无数据</div>;
    
    const prices = orders.map(o => o.publicValue2);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    
    return (
      <div className="price-chart">
        <div className="chart-header">
          <h3>碳信用价格趋势</h3>
          <div className="price-range">
            <span>¥{minPrice}</span>
            <span>¥{maxPrice}</span>
          </div>
        </div>
        <div className="chart-bars">
          {orders.map((order, index) => (
            <div 
              key={index} 
              className="chart-bar-container"
              style={{ height: `${((order.publicValue2 - minPrice) / (maxPrice - minPrice || 1)) * 100}%` }}
            >
              <div className="chart-bar"></div>
              <div className="bar-label">¥{order.publicValue2}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className="faq-section">
        <h3>常见问题解答</h3>
        <div className="faq-item">
          <div className="faq-question">什么是碳信用隐私互换？</div>
          <div className="faq-answer">企业间交换碳信用，数量和价格加密，保护产能数据。</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">如何使用FHE技术？</div>
          <div className="faq-answer">通过全同态加密技术，在加密状态下处理数据，保护隐私。</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">如何验证数据？</div>
          <div className="faq-answer">点击"验证解密"按钮进行链下解密和链上验证。</div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>碳權隱私互換 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🌿</div>
            <h2>连接钱包开始使用</h2>
            <p>请连接您的钱包以访问加密碳信用交换平台。</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>点击上方按钮连接钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系统将自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始创建和交易加密碳信用</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p>状态: {fhevmInitializing ? "初始化FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密碳信用系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>碳權隱私互换 🔐</h1>
          <div className="subtitle">全同态加密碳信用交易平台</div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + 新建订单
          </button>
          <button 
            onClick={checkAvailability} 
            className="check-btn"
          >
            检查合约
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>碳信用市场概览</h2>
          {renderStatsPanel()}
          
          <div className="chart-section">
            {renderPriceChart()}
          </div>
        </div>
        
        <div className="orders-section">
          <div className="section-header">
            <h2>活跃碳信用订单</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "刷新中..." : "刷新"}
              </button>
              <button 
                onClick={() => setShowFAQ(!showFAQ)} 
                className="faq-btn"
              >
                {showFAQ ? "隐藏FAQ" : "显示FAQ"}
              </button>
            </div>
          </div>
          
          {showFAQ && renderFAQ()}
          
          <div className="orders-list">
            {orders.length === 0 ? (
              <div className="no-orders">
                <p>未找到碳信用订单</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  创建首单
                </button>
              </div>
            ) : orders.map((order, index) => (
              <div 
                className={`order-item ${selectedOrder?.id === order.id ? "selected" : ""} ${order.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedOrder(order)}
              >
                <div className="order-title">{order.name}</div>
                <div className="order-meta">
                  <span>价格: ¥{order.publicValue2}</span>
                  <span>创建: {new Date(order.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="order-description">{order.description}</div>
                <div className="order-status">
                  状态: {order.isVerified ? "✅ 已验证" : "🔓 待验证"}
                  {order.isVerified && order.decryptedAmount && (
                    <span className="verified-amount">数量: {order.decryptedAmount}</span>
                  )}
                </div>
                <div className="order-creator">创建者: {order.creator.substring(0, 6)}...{order.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateOrder 
          onSubmit={createOrder} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingOrder} 
          orderData={newOrderData} 
          setOrderData={setNewOrderData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedOrder && (
        <OrderDetailModal 
          order={selectedOrder} 
          onClose={() => { 
            setSelectedOrder(null); 
            setDecryptedData({ amount: null, price: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedOrder.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <p>© 2023 碳權隱私互换平台 | 使用全同态加密技术保护您的交易隐私</p>
          <div className="footer-links">
            <a href="#">用户协议</a>
            <a href="#">隐私政策</a>
            <a href="#">联系我们</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

const ModalCreateOrder: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  orderData: any;
  setOrderData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, orderData, setOrderData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'amount' || name === 'price') {
      const intValue = value.replace(/[^\d]/g, '');
      setOrderData({ ...orderData, [name]: intValue });
    } else {
      setOrderData({ ...orderData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-order-modal">
        <div className="modal-header">
          <h2>新建碳信用订单</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密</strong>
            <p>碳信用数量和价格将使用Zama FHE加密</p>
          </div>
          
          <div className="form-group">
            <label>订单名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={orderData.name} 
              onChange={handleChange} 
              placeholder="输入订单名称..." 
            />
          </div>
          
          <div className="form-group">
            <label>碳信用数量 (整数) *</label>
            <input 
              type="number" 
              name="amount" 
              value={orderData.amount} 
              onChange={handleChange} 
              placeholder="输入数量..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>单价 (¥) *</label>
            <input 
              type="number" 
              name="price" 
              value={orderData.price} 
              onChange={handleChange} 
              placeholder="输入单价..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">公开数据</div>
          </div>
          
          <div className="form-group">
            <label>订单描述</label>
            <textarea 
              name="description" 
              value={orderData.description} 
              onChange={handleChange} 
              placeholder="输入订单描述..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !orderData.name || !orderData.amount || !orderData.price} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建订单"}
          </button>
        </div>
      </div>
    </div>
  );
};

const OrderDetailModal: React.FC<{
  order: CarbonCreditOrder;
  onClose: () => void;
  decryptedData: { amount: number | null; price: number | null };
  setDecryptedData: (value: { amount: number | null; price: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<{ amount: number, price: number } | null>;
}> = ({ order, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData.amount !== null) { 
      setDecryptedData({ amount: null, price: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ amount: decrypted.amount, price: decrypted.price });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="order-detail-modal">
        <div className="modal-header">
          <h2>订单详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="order-info">
            <div className="info-item">
              <span>订单名称:</span>
              <strong>{order.name}</strong>
            </div>
            <div className="info-item">
              <span>创建者:</span>
              <strong>{order.creator.substring(0, 6)}...{order.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>创建时间:</span>
              <strong>{new Date(order.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>公开单价:</span>
              <strong>¥{order.publicValue2}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>加密碳信用数据</h3>
            
            <div className="data-row">
              <div className="data-label">碳信用数量:</div>
              <div className="data-value">
                {order.isVerified && order.decryptedAmount ? 
                  `${order.decryptedAmount} (已验证)` : 
                  decryptedData.amount !== null ? 
                  `${decryptedData.amount} (本地解密)` : 
                  "🔒 FHE加密整数"
              }
              </div>
              <button 
                className={`decrypt-btn ${(order.isVerified || decryptedData.amount !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : order.isVerified ? (
                  "✅ 已验证"
                ) : decryptedData.amount !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 自中继解密</strong>
                <p>数据在链上加密。点击"验证解密"执行链下解密和链上验证。</p>
              </div>
            </div>
          </div>
          
          {(order.isVerified || decryptedData.amount !== null) && (
            <div className="analysis-section">
              <h3>订单详情</h3>
              <div className="decrypted-values">
                <div className="value-item">
                  <span>碳信用数量:</span>
                  <strong>
                    {order.isVerified ? 
                      `${order.decryptedAmount} (已验证)` : 
                      `${decryptedData.amount} (本地解密)`
                    }
                  </strong>
                  <span className={`data-badge ${order.isVerified ? 'verified' : 'local'}`}>
                    {order.isVerified ? '已验证' : '本地解密'}
                  </span>
                </div>
                <div className="value-item">
                  <span>单价:</span>
                  <strong>¥{order.publicValue2}</strong>
                  <span className="data-badge public">公开数据</span>
                </div>
                <div className="value-item">
                  <span>总价值:</span>
                  <strong>
                    ¥{(order.isVerified ? 
                      (order.decryptedAmount || 0) * order.publicValue2 : 
                      (decryptedData.amount || 0) * order.publicValue2
                    ).toLocaleString()}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!order.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


