package main

import (
	"fmt"
	"os"
)

// Line comment
/* Block
comment */
const Pi = 3.14
const (
	A = iota
	B
)

var count int = 0x1F

type Point struct {
	X, Y float64
	Name string `json:"name"`
}

type Shape interface {
	Area() float64
}

func (p *Point) Move(dx float64) { p.X += dx }

func add(a int, b ...int) (int, error) {
	s := "text \"q\" \n"
	r := 'x'
	raw := `raw
string`
	m := map[string][]int{"a": {1, 2}}
	ch := make(chan int, 3)
	go func() { ch <- 1 }()
	defer fmt.Println(s, r, raw, m, len(b), nil, true, false)
	for i := range b {
		if i > 0 && b[i] != 1e3 {
			continue
		}
	}
	switch x := interface{}(a).(type) {
	case int:
		return x, nil
	default:
		return 0, os.ErrNotExist
	}
}

func main() { _, _ = add(1) }
