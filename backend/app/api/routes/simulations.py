"""
Simulation Lab API routes + WebSocket endpoint.
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.services import simulation_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/simulations", tags=["simulations"])


class CreateSimulationRequest(BaseModel):
    strategy_version_id: str
    symbols: list[str]
    timeframe: str = "1d"
    start_date: str
    end_date: str
    initial_capital: float = 100_000.0
    commission_per_share: float = 0.005
    slippage_ticks: int = 1
    data_provider: str = "auto"
    alpaca_api_key: str | None = None
    alpaca_secret_key: str | None = None


class SkipRequest(BaseModel):
    target_bar: int


@router.post("/create")
async def create_simulation(req: CreateSimulationRequest):
    try:
        return await simulation_service.create_simulation(
            strategy_version_id=req.strategy_version_id,
            symbols=req.symbols, timeframe=req.timeframe,
            start_date=req.start_date, end_date=req.end_date,
            initial_capital=req.initial_capital,
            commission_per_share=req.commission_per_share,
            slippage_ticks=req.slippage_ticks,
            data_provider=req.data_provider,
            alpaca_api_key=req.alpaca_api_key,
            alpaca_secret_key=req.alpaca_secret_key,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Failed to create simulation: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_simulations():
    return simulation_service.list_sessions()


@router.post("/{sid}/step")
async def step_simulation(sid: str):
    r = await simulation_service.step_simulation(sid)
    if r is None:
        raise HTTPException(status_code=404, detail="Not found")
    return r


@router.post("/{sid}/skip")
async def skip_to_bar(sid: str, req: SkipRequest):
    r = await simulation_service.skip_to_bar(sid, req.target_bar)
    if r is None:
        raise HTTPException(status_code=404, detail="Not found")
    return r


@router.post("/{sid}/skip-to-trade")
async def skip_to_next_trade(sid: str):
    r = await simulation_service.skip_to_next_trade(sid)
    if r is None:
        raise HTTPException(status_code=404, detail="Not found")
    return r


@router.post("/{sid}/finalize")
async def finalize_simulation(sid: str):
    r = await simulation_service.finalize_simulation(sid)
    if r is None:
        raise HTTPException(status_code=404, detail="Not found")
    return r


@router.get("/{sid}/equity-curve")
async def get_equity_curve(sid: str):
    c = await simulation_service.get_equity_curve(sid)
    if c is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"equity_curve": c}


@router.get("/{sid}/trades")
async def get_trades(sid: str):
    t = await simulation_service.get_all_trades(sid)
    if t is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"trades": t}


@router.delete("/{sid}")
async def delete_simulation(sid: str):
    if not simulation_service.delete_session(sid):
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}


# Catch-all LAST
@router.get("/{sid}")
async def get_simulation(sid: str):
    s = simulation_service.get_session(sid)
    if not s:
        raise HTTPException(status_code=404, detail="Not found")
    return s.to_dict()


# WebSocket — registered on main app at /ws/simulation/{id}
async def simulation_websocket(websocket: WebSocket, simulation_id: str):
    session = simulation_service.get_session(simulation_id)
    if not session:
        await websocket.close(code=4004, reason="Not found")
        return

    await websocket.accept()
    logger.info("SimWS connected: %s", simulation_id[:8])

    stepper_lock = asyncio.Lock()
    play_task = None

    async def _play_loop():
        nonlocal play_task
        try:
            while session.status == "playing" and session.stepper.has_next():
                async with stepper_lock:
                    snap = session.stepper.step()
                try:
                    await websocket.send_json({"type": "bar", "data": snap.to_dict()})
                except Exception:
                    break
                delay = 1.0 / max(session.speed, 0.1)
                if delay > 0.001:
                    await asyncio.sleep(delay)
            if not session.stepper.has_next():
                session.status = "completed"
                async with stepper_lock:
                    final = session.stepper.finalize()
                try:
                    await websocket.send_json({"type": "completed", "data": final})
                except Exception:
                    pass
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.exception("Play loop error: %s", exc)

    async def _send(msg):
        try:
            await websocket.send_json(msg)
        except Exception:
            pass

    async def _cancel_play():
        nonlocal play_task
        if play_task and not play_task.done():
            play_task.cancel()
            try:
                await play_task
            except asyncio.CancelledError:
                pass
            play_task = None

    try:
        await websocket.send_json({"type": "init", "data": session.to_dict()})

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_json(), timeout=300)
            except asyncio.TimeoutError:
                await websocket.close(code=1000, reason="Timeout")
                break

            action = raw.get("action", "")

            if action == "play":
                if session.status in ("ready", "paused"):
                    session.status = "playing"
                    await _cancel_play()
                    play_task = asyncio.create_task(_play_loop())
                    await _send({"type": "status", "status": "playing"})

            elif action == "pause":
                session.status = "paused"
                await _cancel_play()
                await _send({"type": "status", "status": "paused"})

            elif action == "step":
                session.status = "paused"
                await _cancel_play()
                async with stepper_lock:
                    if session.stepper.has_next():
                        snap = session.stepper.step()
                        await _send({"type": "bar", "data": snap.to_dict()})
                    else:
                        session.status = "completed"
                        final = session.stepper.finalize()
                        await _send({"type": "completed", "data": final})

            elif action == "set_speed":
                session.speed = max(0.1, min(float(raw.get("speed", 1)), 1000))
                await _send({"type": "speed", "speed": session.speed})

            elif action == "skip_to":
                session.status = "paused"
                await _cancel_play()
                async with stepper_lock:
                    snap = session.stepper.skip_to(int(raw.get("bar", 0)))
                if snap:
                    await _send({"type": "bar", "data": snap.to_dict()})
                    await _send({"type": "equity_catchup", "data": session.stepper.get_equity_curve()})

            elif action == "skip_to_trade":
                session.status = "paused"
                await _cancel_play()
                async with stepper_lock:
                    snap = session.stepper.skip_to_next_trade()
                if snap:
                    await _send({"type": "bar", "data": snap.to_dict()})
                    await _send({"type": "equity_catchup", "data": session.stepper.get_equity_curve()})
                elif not session.stepper.has_next():
                    session.status = "completed"
                    async with stepper_lock:
                        final = session.stepper.finalize()
                    await _send({"type": "completed", "data": final})

            elif action == "finalize":
                await _cancel_play()
                session.status = "completed"
                async with stepper_lock:
                    final = session.stepper.finalize()
                await _send({"type": "completed", "data": final})

            elif action == "get_state":
                await _send({"type": "state", "data": session.to_dict()})

            else:
                await _send({"type": "error", "message": f"Unknown: {action}"})

    except WebSocketDisconnect:
        logger.info("SimWS disconnected: %s", simulation_id[:8])
    except Exception as exc:
        logger.exception("SimWS error: %s", exc)
    finally:
        await _cancel_play()
        session.status = "paused"
