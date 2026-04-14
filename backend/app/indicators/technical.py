"""
Core technical indicators computed on pandas DataFrames.
All functions take a DataFrame with OHLCV columns and return a Series or DataFrame.
No lookahead — only past data is used at each bar.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ── Moving averages ───────────────────────────────────────────────────────────

def sma(close: pd.Series, period: int) -> pd.Series:
    return close.rolling(period).mean()


def ema(close: pd.Series, period: int) -> pd.Series:
    return close.ewm(span=period, adjust=False).mean()


def wma(close: pd.Series, period: int) -> pd.Series:
    weights = np.arange(1, period + 1)
    return close.rolling(period).apply(lambda x: np.dot(x, weights) / weights.sum(), raw=True)


def vwma(close: pd.Series, volume: pd.Series, period: int) -> pd.Series:
    return (close * volume).rolling(period).sum() / volume.rolling(period).sum()


# ── ATR ───────────────────────────────────────────────────────────────────────

def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    tr = true_range(high, low, close)
    return tr.ewm(span=period, adjust=False).mean()


# ── Bollinger Bands ───────────────────────────────────────────────────────────

def bollinger_bands(close: pd.Series, period: int = 20, std_dev: float = 2.0) -> pd.DataFrame:
    mid = sma(close, period)
    std = close.rolling(period).std()
    return pd.DataFrame({
        "bb_upper": mid + std_dev * std,
        "bb_mid": mid,
        "bb_lower": mid - std_dev * std,
        "bb_width": (std_dev * std * 2) / mid,
    })


# ── RSI ───────────────────────────────────────────────────────────────────────

def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, adjust=False).mean()
    avg_loss = loss.ewm(com=period - 1, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


# ── MACD ──────────────────────────────────────────────────────────────────────

def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    ema_fast = ema(close, fast)
    ema_slow = ema(close, slow)
    macd_line = ema_fast - ema_slow
    signal_line = ema(macd_line, signal)
    return pd.DataFrame({
        "macd": macd_line,
        "macd_signal": signal_line,
        "macd_hist": macd_line - signal_line,
    })


# ── Stochastic ────────────────────────────────────────────────────────────────

def stochastic(high: pd.Series, low: pd.Series, close: pd.Series, k_period: int = 14, d_period: int = 3) -> pd.DataFrame:
    low_min = low.rolling(k_period).min()
    high_max = high.rolling(k_period).max()
    k = 100 * (close - low_min) / (high_max - low_min).replace(0, np.nan)
    d = k.rolling(d_period).mean()
    return pd.DataFrame({"stoch_k": k, "stoch_d": d})


# ── ADX ───────────────────────────────────────────────────────────────────────

def adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.DataFrame:
    tr = true_range(high, low, close)
    pos_dm = (high - high.shift(1)).clip(lower=0)
    neg_dm = (low.shift(1) - low).clip(lower=0)
    # When both positive, use larger; when one dominates, use it
    mask = pos_dm > neg_dm
    pos_dm = pos_dm.where(mask, 0)
    neg_dm = neg_dm.where(~mask, 0)

    tr_s = tr.ewm(span=period, adjust=False).mean()
    pos_di = 100 * pos_dm.ewm(span=period, adjust=False).mean() / tr_s
    neg_di = 100 * neg_dm.ewm(span=period, adjust=False).mean() / tr_s
    dx = 100 * (pos_di - neg_di).abs() / (pos_di + neg_di).replace(0, np.nan)
    adx_line = dx.ewm(span=period, adjust=False).mean()
    return pd.DataFrame({"adx": adx_line, "plus_di": pos_di, "minus_di": neg_di})


# ── Pivot points ──────────────────────────────────────────────────────────────

def pivot_points(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.DataFrame:
    """Classic pivot points using prior bar OHLC."""
    pp = (high + low + close) / 3
    r1 = 2 * pp - low
    s1 = 2 * pp - high
    r2 = pp + (high - low)
    s2 = pp - (high - low)
    r3 = high + 2 * (pp - low)
    s3 = low - 2 * (high - pp)
    return pd.DataFrame({
        "pp": pp.shift(1),
        "r1": r1.shift(1), "s1": s1.shift(1),
        "r2": r2.shift(1), "s2": s2.shift(1),
        "r3": r3.shift(1), "s3": s3.shift(1),
    })


# ── Chandelier exit ───────────────────────────────────────────────────────────

def chandelier_exit(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 22, mult: float = 3.0) -> pd.DataFrame:
    atr_val = atr(high, low, close, period)
    long_stop = high.rolling(period).max() - mult * atr_val
    short_stop = low.rolling(period).min() + mult * atr_val
    return pd.DataFrame({"chandelier_long": long_stop, "chandelier_short": short_stop})


# ── Previous day / week OHLC ─────────────────────────────────────────────────

def prev_day_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    """Requires DatetimeIndex. Returns prior trading-day OHLC for each bar."""
    daily = df.resample("D").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    daily = daily.shift(1)
    daily.columns = ["pd_open", "pd_high", "pd_low", "pd_close"]
    return df.join(daily.reindex(df.index, method="ffill")[["pd_open", "pd_high", "pd_low", "pd_close"]])


# ── Swing high / low detection ────────────────────────────────────────────────

def swing_highs_lows(high: pd.Series, low: pd.Series, lookback: int = 3) -> pd.DataFrame:
    """
    Causal swing high/low detection using only past bars.
    A bar is marked as swing high if it is the highest value in the last (lookback + 1) bars,
    and swing low if it is the lowest value in the last (lookback + 1) bars.
    """
    window = max(int(lookback), 1) + 1
    rolling_high = high.rolling(window=window, min_periods=window).max()
    rolling_low = low.rolling(window=window, min_periods=window).min()
    sh = (high >= rolling_high).fillna(False)
    sl = (low <= rolling_low).fillna(False)
    return pd.DataFrame({"swing_high": sh, "swing_low": sl})


# ── Keltner Channel ───────────────────────────────────────────────────────────

def keltner_channel(high: pd.Series, low: pd.Series, close: pd.Series,
                    period: int = 20, mult: float = 2.0) -> pd.DataFrame:
    mid = ema(close, period)
    atr_val = atr(high, low, close, period)
    return pd.DataFrame({
        "kc_upper": mid + mult * atr_val,
        "kc_mid": mid,
        "kc_lower": mid - mult * atr_val,
    })


# ── Volume indicators ─────────────────────────────────────────────────────────

def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    direction = np.sign(close.diff()).fillna(0)
    return (direction * volume).cumsum()


def add_technical_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Add a standard set of technical indicators to the price DataFrame."""
    if df.empty:
        return df

    df = df.copy()
    df["sma_20"] = sma(df["close"], 20)
    df["ema_20"] = ema(df["close"], 20)
    df["bb_upper"] = bollinger_bands(df["close"]).loc[:, "bb_upper"]
    df["bb_lower"] = bollinger_bands(df["close"]).loc[:, "bb_lower"]
    df["rsi_14"] = rsi(df["close"], 14)
    df["macd"], df["macd_signal"], df["macd_hist"] = macd(df["close"]).T.values
    df["atr_14"] = atr(df["high"], df["low"], df["close"], 14)
    df["adx_14"] = adx(df["high"], df["low"], df["close"], 14)["adx"]
    df["stoch_k"] = stochastic(df["high"], df["low"], df["close"]).loc[:, "stoch_k"]
    df["stoch_d"] = stochastic(df["high"], df["low"], df["close"]).loc[:, "stoch_d"]
    return df


# ── Hull Moving Average ───────────────────────────────────────────────────────

def hull_ma(close: pd.Series, period: int = 20) -> pd.Series:
    """
    Hull Moving Average — reduces lag vs SMA/EMA.
    HMA(n) = WMA(2 × WMA(n/2) − WMA(n), sqrt(n))
    """
    half = max(period // 2, 1)
    sqrt_n = max(int(np.sqrt(period)), 1)
    wma_half = wma(close, half)
    wma_full = wma(close, period)
    raw = 2 * wma_half - wma_full
    return wma(raw, sqrt_n)


# ── Donchian Channel ──────────────────────────────────────────────────────────

def donchian_channel(high: pd.Series, low: pd.Series, period: int = 20) -> pd.DataFrame:
    """
    Donchian Channel — highest high and lowest low over the period.
    Upper: rolling max of high. Lower: rolling min of low. Mid: average.
    Uses shift(1) so the current bar does not contribute (no lookahead).
    """
    upper = high.shift(1).rolling(period).max()
    lower = low.shift(1).rolling(period).min()
    mid   = (upper + lower) / 2
    return pd.DataFrame({"dc_upper": upper, "dc_mid": mid, "dc_lower": lower})


# ── Ichimoku Cloud ────────────────────────────────────────────────────────────

def ichimoku(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    tenkan_period: int = 9,
    kijun_period: int = 26,
    senkou_b_period: int = 52,
    displacement: int = 26,
) -> pd.DataFrame:
    """
    Ichimoku Kinko Hyo components.

    Tenkan-sen  (Conversion):  (high_9  + low_9)  / 2
    Kijun-sen   (Base):        (high_26 + low_26) / 2
    Senkou A    (Leading A):   (Tenkan + Kijun) / 2, shifted forward
    Senkou B    (Leading B):   (high_52 + low_52) / 2, shifted forward
    Chikou      (Lagging):     close shifted back by displacement

    Note: Senkou lines are shifted *forward* for display. In a live system
    the forward values are projections, not lookahead — they use past data
    shifted into the future index positions.
    """
    tenkan = (high.rolling(tenkan_period).max() + low.rolling(tenkan_period).min()) / 2
    kijun  = (high.rolling(kijun_period).max()  + low.rolling(kijun_period).min())  / 2

    senkou_a = ((tenkan + kijun) / 2).shift(displacement)
    senkou_b = ((high.rolling(senkou_b_period).max() + low.rolling(senkou_b_period).min()) / 2).shift(displacement)
    chikou   = close.shift(-displacement)

    return pd.DataFrame({
        "ichi_tenkan":  tenkan,
        "ichi_kijun":   kijun,
        "ichi_senkou_a": senkou_a,
        "ichi_senkou_b": senkou_b,
        "ichi_chikou":  chikou,
    })


# ── Fractals ──────────────────────────────────────────────────────────────────

def fractals(high: pd.Series, low: pd.Series, n: int = 2) -> pd.DataFrame:
    """
    Williams Fractals — causal detection using only confirmed past bars.

    A fractal high at bar i is confirmed when bar i is the highest high
    in the window [i-n … i] AND the next n bars (i+1 … i+n) are all lower.
    To avoid lookahead we detect fractals on bar i+n (the confirming bar),
    referencing back to the peak bar at i.

    Returns boolean Series:
        fractal_high: True at the confirming bar of a fractal high
        fractal_low:  True at the confirming bar of a fractal low
    """
    n = max(n, 1)
    size = len(high)
    frac_high = np.zeros(size, dtype=bool)
    frac_low  = np.zeros(size, dtype=bool)

    highs = high.values
    lows  = low.values

    for i in range(n, size - n):
        window_h = highs[i - n: i + n + 1]
        if highs[i] == window_h.max() and np.sum(window_h == highs[i]) == 1:
            frac_high[i + n] = True   # mark at confirming bar

        window_l = lows[i - n: i + n + 1]
        if lows[i] == window_l.min() and np.sum(window_l == lows[i]) == 1:
            frac_low[i + n] = True

    return pd.DataFrame(
        {"fractal_high": frac_high, "fractal_low": frac_low},
        index=high.index,
    )


def vwap_session(df: pd.DataFrame) -> pd.Series:
    """Intraday VWAP — resets each day. Requires DatetimeIndex."""
    typical = (df["high"] + df["low"] + df["close"]) / 3
    cumvol = df.groupby(df.index.date)["volume"].cumsum()
    cumtp_vol = df.groupby(df.index.date).apply(lambda g: (typical[g.index] * g["volume"]).cumsum()).values
    return pd.Series(cumtp_vol / cumvol.values, index=df.index)
